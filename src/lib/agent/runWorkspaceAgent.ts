import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "../db";
import { generateWorkspacePlan } from "../provider";
import type { ReplayPhase, RunStatus, WorkspaceSnapshot } from "../types";
import {
  addMessage,
  getWorkspaceDataset,
  getWorkspaceSnapshot,
  getWorkspaceThread,
  parseDatasetColumns,
  parseDatasetRows,
  updateWorkspaceThread,
  workspaceId,
  workspaceNow,
} from "../workspace/repo";
import { runWorkspaceTools, type WorkspaceToolResult } from "./workspaceTools";
import { applyLearnedRules } from "../workspace/rules";
import { detectPolicyDrift } from "../workspace/drift";
import { autoApplyRepairsForRun } from "../workspace/repairDecision";
import { infoFor } from "../issueInfo";

export interface WorkspaceRunInput {
  threadId: string;
  instruction: string;
  promptKey?: string | null;
}

export interface WorkspaceRunResult {
  ok: boolean;
  threadId: string;
  runId: string | null;
  state: string;
  message: string;
  output_hash?: string;
  error_category?: string;
  snapshot?: WorkspaceSnapshot;
}

export async function runWorkspaceAgent(
  input: WorkspaceRunInput,
): Promise<WorkspaceRunResult> {
  const thread = getWorkspaceThread(input.threadId);
  if (!thread) {
    return {
      ok: false,
      threadId: input.threadId,
      runId: null,
      state: "failed",
      message: "未找到这个会话。",
      error_category: "thread_not_found",
    };
  }
  const dataset = getWorkspaceDataset(thread.id);
  if (!dataset) {
    return {
      ok: false,
      threadId: thread.id,
      runId: null,
      state: "failed",
      message: "还没有接入表格或数据源。",
      error_category: "dataset_missing",
    };
  }

  const instruction = input.instruction.trim();
  if (!instruction) {
    return {
      ok: false,
      threadId: thread.id,
      runId: null,
      state: "has_context",
      message: "请先输入一个价格治理任务。",
      error_category: "instruction_missing",
      snapshot: getWorkspaceSnapshot(thread.id),
    };
  }

  const db = getDb();
  const started = new Date();
  const startedIso = started.toISOString();
  const runId = workspaceId("RUN-WS");
  addMessage(thread.id, "user", instruction, {
    prompt_key: input.promptKey ?? null,
    dataset_id: dataset.id,
  });
  updateWorkspaceThread(thread.id, {
    state: "running",
    lastInstruction: instruction,
    providerStatus: "running",
  });

  const rows = parseDatasetRows(dataset);
  const columns = parseDatasetColumns(dataset);
  const events: Array<{ phase: ReplayPhase; title: string; detail: string; ok: boolean }> = [];
  events.push({
    phase: "observe",
    title: "读取数据上下文",
    detail: `读取 ${dataset.title}，${rows.length} 行，${columns.length} 个字段；任务：${instruction}`,
    ok: true,
  });

  const toolResult = runWorkspaceTools(rows, columns);
  events.push({
    phase: "tools",
    title: "执行价格治理工具",
    detail: `字段映射 ${toolResult.stats.mappedFields} 个，修复 patch ${toolResult.stats.repairs} 条，归并组 ${toolResult.stats.groups} 个，流程候选 ${toolResult.stats.dispositions} 条。`,
    ok: true,
  });

  const observation = {
    thread: {
      id: thread.id,
      state: thread.state,
      source_label: thread.source_label,
      prior_instruction: thread.last_instruction,
    },
    dataset: {
      id: dataset.id,
      title: dataset.title,
      source_type: dataset.source_type,
      rows: rows.length,
      columns,
      synthetic: Boolean(dataset.synthetic),
    },
    user_instruction: instruction,
    prompt_key: input.promptKey ?? null,
    deterministic_result: {
      stats: toolResult.stats,
      mappings: toolResult.mappings.slice(0, 10),
      repairs: toolResult.repairs.slice(0, 8),
      groups: toolResult.groups.slice(0, 6),
      dispositions: toolResult.dispositions.slice(0, 8),
      questions: toolResult.questions,
    },
    boundary:
      "只创建内部 workflow_task 和 institution_draft，不真实发函/通报/关闭；演示数据为合成/脱敏。",
  };

  const provider = await generateWorkspacePlan(observation);
  let providerMeta: Record<string, unknown>;
  let answer: string;
  let state: "ready" | "needs_user" | "draft_unavailable" | "failed";
  let status: RunStatus;
  let errorCategory: string | null = null;

  if (provider.ok) {
    providerMeta = { source: "live-provider", ...provider.meta };
    events.push({
      phase: "plan",
      title: "生成处理计划",
      detail: provider.plan.plan_summary || "已生成价格治理处理计划。",
      ok: true,
    });
    state =
      toolResult.questions.length > 0 || provider.plan.clarifying_question
        ? "needs_user"
        : "ready";
    status = "success";
    answer = buildAssistantAnswer(toolResult, provider.plan.answer, provider.plan.clarifying_question);
  } else {
    providerMeta = {
      source: "degraded",
      category: provider.category,
      ...(provider.meta ?? {}),
    };
    events.push({
      phase: "recover",
      title: "Provider 不可用",
      detail: `${provider.category}: ${provider.message}。确定性工具结果已保留，草稿生成标记为不可用。`,
      ok: false,
    });
    state = "draft_unavailable";
    status = "degraded";
    errorCategory = provider.category;
    answer = `我已经完成字段映射、修复候选、归并和规则评估，但 provider 不可用，机构口径草稿暂不生成。原因：${provider.message}`;
  }

  const outputHash = hashOutput({
    runId,
    instruction,
    stats: toolResult.stats,
    provider: provider.ok ? provider.raw : providerMeta,
    questions: toolResult.questions,
  });

  persistRun({
    db,
    threadId: thread.id,
    datasetId: dataset.id,
    runId,
    instruction,
    promptKey: input.promptKey ?? null,
    toolResult,
    providerOk: provider.ok,
    providerPlan: provider.ok ? provider.plan : null,
    providerMeta,
    answer,
    outputHash,
    status,
    errorCategory,
    startedIso,
    durationMs: Date.now() - started.getTime(),
    events,
  });

  // 高置信修复不等人：目录别名等确定性修复立即物理回写数据集，auto_approved 留痕；
  // 其余（proposed/needs_user）进对话流提案卡等人确认。
  const autoRepair = autoApplyRepairsForRun(thread.id, runId);
  if (autoRepair.autoApplied > 0) {
    insertRunEvent(
      db,
      thread.id,
      runId,
      "mutate",
      "自动修复回写",
      `${autoRepair.autoApplied} 条高置信修复已自动回写数据集（决策日志留痕）；${autoRepair.pendingHuman} 条拿不准的转提案卡待人工确认。`,
      true,
      { ...autoRepair },
    );
  }

  const followupChanged = applyFollowupPolicyIfNeeded(thread.id, runId, instruction);
  if (followupChanged > 0) {
    insertRunEvent(db, thread.id, runId, "mutate", "续办规则已更新", `根据追问更新 ${followupChanged} 条已有流程任务。`, true, {
      followup_changed_tasks: followupChanged,
    });
  }

  // V2.2 政策漂移检测：baseline 从 policy_fact 现读（真相源），observed 用本次观察价。
  // 政策更新（policy-update / artifact confirm）改了 policy_fact 后，这里会真实检出漂移。
  const driftGroups = toolResult.basisPacks.map((bp) => {
    const b = bp.basis as Record<string, unknown>;
    return {
      group_key: bp.group_key,
      raw_item_code: (b.raw_item_code as string | null) ?? null,
      catalog_matched: Boolean(b.catalog_matched),
      observed_min: (b.observed_min as number | null) ?? null,
      observed_max: (b.observed_max as number | null) ?? null,
    };
  });
  const drift = detectPolicyDrift({ threadId: thread.id, runId, groups: driftGroups });
  if (drift.detected > 0) {
    insertRunEvent(
      db,
      thread.id,
      runId,
      "verify",
      "政策漂移检测",
      `对照 policy_fact 检出 ${drift.detected} 条政策漂移（critical ${drift.critical} / high ${drift.high} / medium ${drift.medium}），创建 ${drift.tasksCreated} 个「政策漂移复核」人审任务。`,
      true,
      { ...drift },
    );
  }

  // V2 自学习规则引擎：对本次生成的 disposition 应用已激活的学习规则。
  // 高置信 + 护栏通过 → 自动处置；低置信/敏感 → 转人审。全程写 approval_decision_log。
  if (provider.ok) {
    const learned = applyLearnedRules(thread.id, runId);
    if (learned.autoApproved > 0 || learned.escalatedToHuman > 0) {
      insertRunEvent(
        db,
        thread.id,
        runId,
        "learn",
        "学习规则引擎",
        `自动处置 ${learned.autoApproved} 条，转人审 ${learned.escalatedToHuman} 条。`,
        true,
        { ...learned },
      );
    }
  }

  addMessage(thread.id, "assistant", answer, {
    run_id: runId,
    provider: providerMeta,
    output_hash: outputHash,
    stats: toolResult.stats,
  });
  updateWorkspaceThread(thread.id, {
    state,
    lastInstruction: instruction,
    providerStatus: provider.ok ? "live-provider" : String(errorCategory),
  });

  return {
    ok: provider.ok,
    threadId: thread.id,
    runId,
    state,
    message: answer,
    output_hash: outputHash,
    error_category: errorCategory ?? undefined,
    snapshot: getWorkspaceSnapshot(thread.id),
  };
}

function buildAssistantAnswer(
  tools: WorkspaceToolResult,
  providerAnswer: string,
  providerQuestion: string,
): string {
  const autoFixed = tools.repairs.filter((r) => r.status === "applied").length;
  const pendingFix = tools.repairs.length - autoFixed;
  const lines = [
    providerAnswer ||
      `我已先把这批数据跑完：映射 ${tools.stats.mappedFields} 个字段，生成 ${tools.stats.repairs} 条修复 patch，归并 ${tools.stats.groups} 个同品同规组，并创建 ${tools.stats.tasks} 个流程对象。`,
  ];
  if (autoFixed > 0 || pendingFix > 0) {
    const parts: string[] = [];
    if (autoFixed > 0) parts.push(`${autoFixed} 条高置信问题已自动修复并回写数据集（无需人工）`);
    if (pendingFix > 0) parts.push(`${pendingFix} 条拿不准的在下方提案卡等你确认，可先改值再采纳`);
    lines.push(parts.join("；") + "。");
  }
  if (tools.questions.length > 0 || providerQuestion) {
    const question = providerQuestion || tools.questions[0];
    lines.push(`需要你确认一件事：${question}`);
  }
  lines.push(
    `已落库对象：字段映射、修复 patch、归并组、单位换算、价格口径、处置项、机构草稿和流程任务。`,
  );
  return lines.filter(Boolean).join("\n");
}

function persistRun(input: {
  db: ReturnType<typeof getDb>;
  threadId: string;
  datasetId: string;
  runId: string;
  instruction: string;
  promptKey: string | null;
  toolResult: WorkspaceToolResult;
  providerOk: boolean;
  providerPlan: {
    plan_summary: string;
    ordered_steps: { key: string; label: string; reason: string }[];
    answer: string;
    clarifying_question: string;
    drafts: { target_name: string; draft_type: string; content: string }[];
    task_policy: string;
  } | null;
  providerMeta: Record<string, unknown>;
  answer: string;
  outputHash: string;
  status: RunStatus;
  errorCategory: string | null;
  startedIso: string;
  durationMs: number;
  events: Array<{ phase: ReplayPhase; title: string; detail: string; ok: boolean }>;
}) {
  const db = input.db;
  const created = workspaceNow();

  db.prepare(
    `INSERT INTO agent_instruction
     (id, thread_id, run_id, prompt_key, instruction, instruction_type, created_at)
     VALUES (:id, :thread_id, :run_id, :prompt_key, :instruction, :instruction_type, :created_at)`,
  ).run({
    id: workspaceId("INS"),
    thread_id: input.threadId,
    run_id: input.runId,
    prompt_key: input.promptKey,
    instruction: input.instruction,
    instruction_type: input.promptKey ? "built_in_prompt" : "custom",
    created_at: created,
  });

  const insMapping = db.prepare(
    `INSERT INTO field_mapping
     (id, thread_id, run_id, dataset_id, source_column, target_field, confidence, status, reason, created_at)
     VALUES (:id, :thread_id, :run_id, :dataset_id, :source_column, :target_field, :confidence, :status, :reason, :created_at)`,
  );
  for (const m of input.toolResult.mappings) {
    insMapping.run({
      id: workspaceId("MAP"),
      thread_id: input.threadId,
      run_id: input.runId,
      dataset_id: input.datasetId,
      source_column: m.source_column,
      target_field: m.target_field,
      confidence: m.confidence,
      status: m.status,
      reason: m.reason,
      created_at: created,
    });
  }

  const insRepair = db.prepare(
    `INSERT INTO repair_patch
     (id, thread_id, run_id, dataset_id, row_index, field, before_value, after_value, status, reason, confidence, created_at)
     VALUES (:id, :thread_id, :run_id, :dataset_id, :row_index, :field, :before_value, :after_value, :status, :reason, :confidence, :created_at)`,
  );
  for (const r of input.toolResult.repairs) {
    insRepair.run({
      id: workspaceId("RPA"),
      thread_id: input.threadId,
      run_id: input.runId,
      dataset_id: input.datasetId,
      row_index: r.row_index,
      field: r.field,
      before_value: r.before_value,
      after_value: r.after_value,
      status: r.status,
      reason: r.reason,
      confidence: r.confidence,
      created_at: created,
    });
  }

  const groupIdByKey = new Map<string, string>();
  const insGroup = db.prepare(
    `INSERT INTO match_group
     (id, thread_id, run_id, dataset_id, group_key, item_name, row_indexes_json, status, reason_json, created_at)
     VALUES (:id, :thread_id, :run_id, :dataset_id, :group_key, :item_name, :row_indexes_json, :status, :reason_json, :created_at)`,
  );
  for (const g of input.toolResult.groups) {
    const groupId = workspaceId("GRP");
    groupIdByKey.set(g.group_key, groupId);
    insGroup.run({
      id: groupId,
      thread_id: input.threadId,
      run_id: input.runId,
      dataset_id: input.datasetId,
      group_key: g.group_key,
      item_name: g.item_name,
      row_indexes_json: JSON.stringify(g.row_indexes),
      status: g.status,
      reason_json: JSON.stringify(g.reasons),
      created_at: created,
    });
  }

  const insConversion = db.prepare(
    `INSERT INTO unit_conversion
     (id, thread_id, run_id, group_id, source_unit, target_unit, formula, converted_count, status, created_at)
     VALUES (:id, :thread_id, :run_id, :group_id, :source_unit, :target_unit, :formula, :converted_count, :status, :created_at)`,
  );
  for (const c of input.toolResult.conversions) {
    insConversion.run({
      id: workspaceId("UNC"),
      thread_id: input.threadId,
      run_id: input.runId,
      group_id: groupIdByKey.get(c.group_key) ?? c.group_key,
      source_unit: c.source_unit,
      target_unit: c.target_unit,
      formula: c.formula,
      converted_count: c.converted_count,
      status: c.status,
      created_at: created,
    });
  }

  const insBasis = db.prepare(
    `INSERT INTO price_basis_pack
     (id, thread_id, run_id, group_id, basis_json, created_at)
     VALUES (:id, :thread_id, :run_id, :group_id, :basis_json, :created_at)`,
  );
  for (const b of input.toolResult.basisPacks) {
    insBasis.run({
      id: workspaceId("PBP"),
      thread_id: input.threadId,
      run_id: input.runId,
      group_id: groupIdByKey.get(b.group_key) ?? b.group_key,
      basis_json: JSON.stringify(b.basis),
      created_at: created,
    });
  }

  const insEvaluation = db.prepare(
    `INSERT INTO rule_evaluation
     (id, thread_id, run_id, group_id, result, reason_code, detail, created_at)
     VALUES (:id, :thread_id, :run_id, :group_id, :result, :reason_code, :detail, :created_at)`,
  );
  for (const e of input.toolResult.evaluations) {
    insEvaluation.run({
      id: workspaceId("REV"),
      thread_id: input.threadId,
      run_id: input.runId,
      group_id: groupIdByKey.get(e.group_key) ?? e.group_key,
      result: e.result,
      reason_code: e.reason_code,
      detail: e.detail,
      created_at: created,
    });
  }

  const dispositionIdByIndex = new Map<number, string>();
  const insDisposition = db.prepare(
    `INSERT INTO disposition_item
     (id, thread_id, run_id, group_id, row_index, item_name, institution_name, issue_type, severity, status, next_action, created_at, updated_at)
     VALUES (:id, :thread_id, :run_id, :group_id, :row_index, :item_name, :institution_name, :issue_type, :severity, :status, :next_action, :created_at, :updated_at)`,
  );
  for (const d of input.toolResult.dispositions) {
    const dispositionId = workspaceId("DSP");
    dispositionIdByIndex.set(d.row_index, dispositionId);
    insDisposition.run({
      id: dispositionId,
      thread_id: input.threadId,
      run_id: input.runId,
      group_id: d.group_key ? groupIdByKey.get(d.group_key) ?? d.group_key : null,
      row_index: d.row_index,
      item_name: d.item_name,
      institution_name: d.institution_name,
      issue_type: d.issue_type,
      severity: d.severity,
      status: d.status,
      next_action: d.next_action,
      created_at: created,
      updated_at: created,
    });
  }

  const insTask = db.prepare(
    `INSERT INTO workflow_task
     (id, thread_id, run_id, disposition_id, task_type, owner_role, status, priority, due_at, title, detail, created_at, updated_at)
     VALUES (:id, :thread_id, :run_id, :disposition_id, :task_type, :owner_role, :status, :priority, :due_at, :title, :detail, :created_at, :updated_at)`,
  );
  // 每条处置项都要有对应流程任务（可审批对象闭环）；上限 24 防止超大上传刷屏。
  for (const d of input.toolResult.dispositions.slice(0, 24)) {
    const isData = d.next_action.includes("数据治理") || d.issue_type.includes("schema");
    const isCollective = d.issue_type.includes("collective");
    insTask.run({
      id: workspaceId("WFT"),
      thread_id: input.threadId,
      run_id: input.runId,
      disposition_id: dispositionIdByIndex.get(d.row_index) ?? null,
      task_type: isData ? "数据治理确认" : isCollective ? "集采落地催办" : "机构核实",
      owner_role: isData ? "数据治理岗" : isCollective ? "集采落地专班" : "价格治理岗",
      status: "workflow_pending_review",
      priority: d.severity === "high" ? "high" : "normal",
      due_at: new Date(Date.now() + (d.severity === "high" ? 4 : 24) * 60 * 60 * 1000).toISOString(),
      title: `${d.institution_name} · ${d.item_name}`,
      // 人话说明：问题是什么（业务名）+ 建议怎么办，不给裸字段
      detail: `${infoFor(d.issue_type).title}。建议：${d.next_action}`,
      created_at: created,
      updated_at: created,
    });
  }

  for (const question of input.toolResult.questions) {
    insTask.run({
      id: workspaceId("WFT"),
      thread_id: input.threadId,
      run_id: input.runId,
      disposition_id: null,
      task_type: "数据治理确认",
      owner_role: "数据治理岗",
      status: "待确认",
      priority: "high",
      due_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      title: "补充字段/单位口径",
      detail: question,
      created_at: created,
      updated_at: created,
    });
  }

  const insDraft = db.prepare(
    `INSERT INTO institution_draft
     (id, thread_id, run_id, disposition_id, target_name, draft_type, content, status, provider_meta_json, created_at, updated_at)
     VALUES (:id, :thread_id, :run_id, :disposition_id, :target_name, :draft_type, :content, :status, :provider_meta_json, :created_at, :updated_at)`,
  );
  if (input.providerOk && input.providerPlan) {
    const drafts = input.providerPlan.drafts.length
      ? input.providerPlan.drafts
      : input.toolResult.dispositions.slice(0, 2).map((d) => ({
          target_name: d.institution_name,
          draft_type: d.issue_type.includes("collective") ? "集采催办" : "机构核实",
          content: input.providerPlan?.answer || input.answer,
        }));
    for (const draft of drafts.slice(0, 4)) {
      insDraft.run({
        id: workspaceId("DRF"),
        thread_id: input.threadId,
        run_id: input.runId,
        disposition_id: null,
        target_name: draft.target_name,
        draft_type: draft.draft_type,
        content: draft.content,
        status: "generated",
        provider_meta_json: JSON.stringify(input.providerMeta),
        created_at: created,
        updated_at: created,
      });
    }
  } else {
    insDraft.run({
      id: workspaceId("DRF"),
      thread_id: input.threadId,
      run_id: input.runId,
      disposition_id: null,
      target_name: "草稿生成",
      draft_type: "draft_unavailable",
      content: "Provider 不可用，未生成机构口径草稿。",
      status: "draft_unavailable",
      provider_meta_json: JSON.stringify(input.providerMeta),
      created_at: created,
      updated_at: created,
    });
  }

  for (const event of input.events) {
    insertRunEvent(
      db,
      input.threadId,
      input.runId,
      event.phase,
      event.title,
      event.detail,
      event.ok,
      event,
    );
  }
  insertRunEvent(db, input.threadId, input.runId, "mutate", "写入工作对象", "会话、字段映射、修复、归并、草稿和流程任务已写入 SQLite。", true, {
    stats: input.toolResult.stats,
  });
  insertRunEvent(db, input.threadId, input.runId, "verify", "可复查结果", `run=${input.runId}, hash=${input.outputHash}，重新打开工作台可读取生成对象。`, true, {
    output_hash: input.outputHash,
  });

  const finished = workspaceNow();
  db.prepare(
    `INSERT INTO agent_run
     (id, release_id, mutation_type, input_summary, candidate_json, plan_json, tools_json, result_state, before_state, after_state, provider_meta_json, status, error_category, output_hash, duration_ms, started_at, finished_at)
     VALUES (:id, :release_id, :mutation_type, :input_summary, :candidate_json, :plan_json, :tools_json, :result_state, :before_state, :after_state, :provider_meta_json, :status, :error_category, :output_hash, :duration_ms, :started_at, :finished_at)`,
  ).run({
    id: input.runId,
    release_id: input.threadId,
    mutation_type: "workspace_conversation",
    input_summary: `${input.instruction.slice(0, 80)} -> ${input.toolResult.stats.tasks} 个流程对象`,
    candidate_json: JSON.stringify({ stats: input.toolResult.stats }),
    plan_json: JSON.stringify(input.providerPlan ?? { degraded: input.errorCategory }),
    tools_json: JSON.stringify(input.events),
    result_state: input.toolResult.questions.length ? "需核验" : "可落地",
    before_state: "待治理",
    after_state: input.toolResult.questions.length ? "需核验" : "可落地",
    provider_meta_json: JSON.stringify(input.providerMeta),
    status: input.status,
    error_category: input.errorCategory,
    output_hash: input.outputHash,
    duration_ms: input.durationMs,
    started_at: input.startedIso,
    finished_at: finished,
  });
}

function insertRunEvent(
  db: ReturnType<typeof getDb>,
  threadId: string,
  runId: string,
  phase: ReplayPhase,
  title: string,
  detail: string,
  ok: boolean,
  event: Record<string, unknown>,
) {
  db.prepare(
    `INSERT INTO run_event
     (id, thread_id, run_id, phase, title, detail, ok, event_json, created_at)
     VALUES (:id, :thread_id, :run_id, :phase, :title, :detail, :ok, :event_json, :created_at)`,
  ).run({
    id: workspaceId("EVT"),
    thread_id: threadId,
    run_id: runId,
    phase,
    title,
    detail,
    ok: ok ? 1 : 0,
    event_json: JSON.stringify(event),
    created_at: workspaceNow(),
  });
}

function applyFollowupPolicyIfNeeded(
  threadId: string,
  runId: string,
  instruction: string,
): number {
  const normalized = instruction.replace(/\s/g, "");
  const wantsDataGovernance =
    normalized.includes("缺包装单位") ||
    normalized.includes("数据治理确认") ||
    normalized.includes("先转数据治理");
  const wantsKeyInstitution = normalized.includes("重点机构") || normalized.includes("放前面");
  if (!wantsDataGovernance && !wantsKeyInstitution) return 0;

  const db = getDb();
  const now = workspaceNow();
  let changed = 0;
  if (wantsDataGovernance) {
    const result = db
      .prepare(
        `UPDATE workflow_task
         SET task_type = '数据治理确认', owner_role = '数据治理岗', status = '待确认',
             priority = 'high', detail = detail || '；按追问先转数据治理确认。', updated_at = :updated_at
         WHERE thread_id = :thread_id AND task_type != '政策漂移复核'
           AND (title LIKE '%单位%' OR detail LIKE '%单位%' OR task_type != '数据治理确认')`,
      )
      .run({ thread_id: threadId, updated_at: now });
    changed += Number(result.changes ?? 0);
  }
  if (wantsKeyInstitution) {
    const result = db
      .prepare(
        `UPDATE workflow_task
         SET priority = 'high', detail = detail || '；按追问重点机构优先。', updated_at = :updated_at
         WHERE thread_id = :thread_id AND title LIKE '%市人民医院%'`,
      )
      .run({ thread_id: threadId, updated_at: now });
    changed += Number(result.changes ?? 0);
  }
  if (changed > 0) {
    db.prepare(
      `INSERT INTO conversation_message
       (id, thread_id, role, content, meta_json, created_at)
       VALUES (:id, :thread_id, 'system', :content, :meta_json, :created_at)`,
    ).run({
      id: workspaceId("MSG"),
      thread_id: threadId,
      content: `续办规则已应用到 ${changed} 条流程任务。`,
      meta_json: JSON.stringify({ run_id: runId, followup_changed_tasks: changed }),
      created_at: workspaceNow(),
    });
  }
  return changed;
}

function hashOutput(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
