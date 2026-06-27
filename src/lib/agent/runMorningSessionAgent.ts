import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db";
import {
  getMorningSession,
  getReplayByRun,
  getRows,
  listFollowUpTasks,
  listReleases,
  listWatchlist,
} from "../repo";
import { CODE_ALIASES, PRICE_CATALOG } from "../fixtures";
import { generateMorningSessionPlan } from "../provider";
import { classifyRow, type CandidateRow } from "./tools";
import type {
  AgentPlan,
  DailyLeadStatus,
  DatasetRelease,
  DatasetRow,
  ReplayEvent,
  ReleaseState,
  RowVerdict,
  RunStatus,
  ToolCall,
} from "../types";

export interface OpenMorningInput {
  openedBy?: string;
  orgScope?: string;
  priorityText?: string;
  sourceCutoffAt?: string;
  rerankFromSessionId?: string;
}

export interface MorningRunResult {
  ok: boolean;
  sessionId: string;
  runId: string;
  status: "planned" | "partial_failed" | "failed";
  leadCount: number;
  message: string;
  output_hash?: string;
  error_category?: string;
}

interface LeadCandidate {
  lead_type: string;
  source_ref_type: string;
  source_ref_id: string;
  institution_id: string | null;
  institution_name_masked: string;
  region_code: string | null;
  item_code: string;
  item_name: string;
  spec: string | null;
  package_unit: string | null;
  baseline_price: number | null;
  execution_price: number | null;
  delta_pct: number | null;
  priority_score: number;
  priority_reasons: string[];
  evidence_gap: string[];
  evidence: Record<string, unknown>;
  next_action: string;
  owner_role: string;
  due_at: string | null;
  status: DailyLeadStatus;
  human_confirmation_required: number;
}

const SESSION_KIND = "morning_session";

export async function runMorningSessionAgent(
  input: OpenMorningInput = {},
): Promise<MorningRunResult> {
  const db = getDb();
  const started = new Date();
  const now = started.toISOString();
  const sessionDate = todayInShanghai();
  const sessionId = `MOR-${sessionDate.replace(/-/g, "")}-${randomUUID().slice(0, 6)}`;
  const runId = `RUN-MOR-${sessionDate.replace(/-/g, "")}-${randomUUID().slice(0, 6)}`;
  const priorityInput = {
    text:
      input.priorityText?.trim() ||
      "今天优先看集采落地差异、重点机构执行价、昨日未回访。",
    source: input.rerankFromSessionId ? "rerank" : "morning_open",
    rerank_from_session_id: input.rerankFromSessionId ?? null,
  };

  insertMorningSession(db, {
    id: sessionId,
    sessionDate,
    orgScope: input.orgScope || "市级医保价格治理岗",
    openedBy: input.openedBy || "价格治理岗",
    sourceCutoffAt: input.sourceCutoffAt || now,
    priorityInput,
    status: "opening",
    leadCount: 0,
    statusSummary: { state: "opening" },
    daybookSummary: {},
    agentRunId: null,
    openedAt: now,
    createdAt: now,
  });

  const replay: ReplayEvent[] = [];
  const tNow = () => new Date().toISOString();
  const releases = listReleases();
  const watchlist = listWatchlist();
  const followUps = listFollowUpTasks();
  const overdueFollowUps = followUps.filter((x) =>
    ["overdue", "open", "pending"].includes(String(x.status)),
  );
  const rowObservations = buildRowCandidates(releases, priorityInput.text);
  const seedCandidates = [
    ...buildFollowUpCandidates(overdueFollowUps, priorityInput.text),
    ...buildWatchlistCandidates(watchlist, priorityInput.text),
    ...rowObservations.candidates,
  ];

  replay.push({
    phase: "observe",
    title: "observe 读取今日来源",
    detail: `读取 ${releases.length} 个价格批次、${rowObservations.scannedRows} 行价格记录、${watchlist.length} 个重点对象、${overdueFollowUps.length} 个待回访任务。`,
    at: tNow(),
    ok: true,
  });

  if (seedCandidates.length === 0) {
    const outputHash = hashOutput({ sessionId, empty: true });
    const finished = new Date().toISOString();
    insertRun(db, {
      runId,
      sessionId,
      inputSummary: "今日晨会无可排序线索",
      candidate: { sources: sourceSummary(releases, rowObservations.scannedRows, watchlist.length, overdueFollowUps.length) },
      plan: degradedPlan("今日没有待办价格线索。"),
      tools: [],
      resultState: "可落地",
      status: "success",
      errorCategory: null,
      outputHash,
      durationMs: Date.now() - started.getTime(),
      startedIso: now,
      finishedIso: finished,
    });
    insertReplay(db, runId, sessionId, replay);
    updateSession(db, sessionId, {
      status: "planned",
      leadCount: 0,
      agentRunId: runId,
      statusSummary: { state: "empty", message: "今日暂无待处置线索" },
      daybookSummary: { source_count: releases.length, lead_count: 0, sample_data: true },
    });
    return {
      ok: true,
      sessionId,
      runId,
      status: "planned",
      leadCount: 0,
      message: "今日暂无待处置线索。",
      output_hash: outputHash,
    };
  }

  const observation = {
    session: {
      session_date: sessionDate,
      org_scope: input.orgScope || "市级医保价格治理岗",
      opened_by: input.openedBy || "价格治理岗",
      priority_input: priorityInput.text,
      source_cutoff_at: input.sourceCutoffAt || now,
    },
    sources: sourceSummary(releases, rowObservations.scannedRows, watchlist.length, overdueFollowUps.length),
    issue_counts: rowObservations.byIssueType,
    watchlist: watchlist.map((w) => ({
      type: w.watch_type,
      subject: w.subject_name_masked,
      reason: w.reason,
      weight: w.weight,
    })),
    overdue_follow_up_count: overdueFollowUps.length,
    candidate_preview: seedCandidates
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, 8)
      .map((c) => ({
        type: c.lead_type,
        institution: c.institution_name_masked,
        item: c.item_name,
        score: c.priority_score,
        reasons: c.priority_reasons,
        next_action: c.next_action,
        evidence_gap: c.evidence_gap,
      })),
  };

  const planResult = await generateMorningSessionPlan(observation);
  if (!planResult.ok) {
    replay.push({
      phase: "recover",
      title: "recover 晨会未开成",
      detail: `Provider 不可用（${planResult.category}）：${planResult.message}。系统不生成机器排序线索，保留来源摘要供人工查看。`,
      at: tNow(),
      ok: false,
    });
    const outputHash = hashOutput({ sessionId, degraded: planResult.category, sources: observation.sources });
    const finished = new Date().toISOString();
    insertRun(db, {
      runId,
      sessionId,
      inputSummary: "今日价格晨会（provider 降级）",
      candidate: observation,
      plan: degradedPlan(planResult.message),
      tools: [],
      resultState: "检查失败",
      status: "degraded",
      errorCategory: planResult.category,
      outputHash,
      durationMs: Date.now() - started.getTime(),
      startedIso: now,
      finishedIso: finished,
    });
    insertReplay(db, runId, sessionId, replay);
    updateSession(db, sessionId, {
      status: "failed",
      leadCount: 0,
      agentRunId: runId,
      statusSummary: {
        state: "failed",
        category: planResult.category,
        message: planResult.message,
      },
      daybookSummary: {
        ...observation.sources,
        sample_data: true,
        provider_required: true,
      },
    });
    return {
      ok: false,
      sessionId,
      runId,
      status: "failed",
      leadCount: 0,
      error_category: planResult.category,
      message: planResult.message,
      output_hash: outputHash,
    };
  }

  const plan = planResult.plan;
  replay.push({
    phase: "plan",
    title: "plan 排今日优先级",
    detail: `重点=${focusLabel(plan.issue_focus)}。${plan.rationale}`,
    at: tNow(),
    ok: true,
  });

  const leads = rankCandidates(seedCandidates, plan, priorityInput.text).slice(0, 8);
  const createdAt = new Date().toISOString();
  const inserted = insertLeads(db, sessionId, leads, createdAt);
  const tasks = insertDefaultFollowUps(db, sessionId, inserted, createdAt);

  replay.push({
    phase: "tools",
    title: "tools 写入晨会对象",
    detail: `source_reader、issue_ranker、lead_writer、follow_up_writer、replay_builder 已执行；写入 ${inserted.length} 条今日线索和 ${tasks} 条待办。`,
    at: tNow(),
    ok: true,
  });
  replay.push({
    phase: "mutate",
    title: "mutate 形成今日处置表",
    detail: `晨会 ${sessionId} 已从来源摘要转为 daily_lead / follow_up_task，可派核验、退回补证或转处置待确认。`,
    at: tNow(),
    ok: true,
  });

  const resultState = normalizeReleaseState(plan.expected_state, leads);
  const statusSummary = summarizeLeads(leads);
  const daybookSummary = {
    ...observation.sources,
    lead_count: inserted.length,
    top_lead: inserted[0]?.item_name ?? null,
    top_institution: inserted[0]?.institution_name_masked ?? null,
    focus: plan.issue_focus,
    provider: "live-provider",
    sample_data: true,
  };
  const outputHash = hashOutput({ sessionId, plan, leads, daybookSummary });
  const finished = new Date().toISOString();

  insertRun(db, {
    runId,
    sessionId,
    inputSummary: `今日价格晨会 → ${inserted.length} 条线索 / ${tasks} 条待办`,
    candidate: {
      observation,
      status_summary: statusSummary,
      daybook_summary: daybookSummary,
    },
    plan,
    tools: morningTools(inserted.length, tasks),
    resultState,
    status: "success",
    errorCategory: null,
    outputHash,
    durationMs: Date.now() - started.getTime(),
    startedIso: now,
    finishedIso: finished,
    providerMeta: { source: "live-provider", ...planResult.meta },
  });
  insertReplay(db, runId, sessionId, [
    ...replay,
    {
      phase: "verify",
      title: "verify 可回放",
      detail: `重新读取晨会：${getMorningSession(sessionId)?.id ?? sessionId}；${inserted.length} 条线索按优先级保存，run=${runId}，hash=${outputHash}。`,
      at: tNow(),
      ok: true,
    },
  ]);
  updateSession(db, sessionId, {
    status: "planned",
    leadCount: inserted.length,
    agentRunId: runId,
    statusSummary,
    daybookSummary,
  });

  return {
    ok: true,
    sessionId,
    runId,
    status: "planned",
    leadCount: inserted.length,
    message: `已开晨会，排出 ${inserted.length} 条今日线索。`,
    output_hash: outputHash,
  };
}

function buildRowCandidates(
  releases: DatasetRelease[],
  priorityText: string,
): { candidates: LeadCandidate[]; scannedRows: number; byIssueType: Record<string, number> } {
  const candidates: LeadCandidate[] = [];
  const byIssueType: Record<string, number> = {};
  let scannedRows = 0;

  for (const release of releases) {
    const rows = getRows(release.id);
    scannedRows += rows.length;
    for (const row of rows) {
      const candidate: CandidateRow = {
        item_code: row.item_code,
        item_name: row.item_name,
        price_date: row.price_date,
        procurement_channel: row.procurement_channel,
        region: row.region,
        unit_price: row.unit_price,
      };
      const { verdict, findings } = classifyRow(candidate, release.release_date);
      if (!verdict.issueType) continue;
      byIssueType[verdict.issueType] = (byIssueType[verdict.issueType] ?? 0) + 1;
      candidates.push(rowToLeadCandidate(release, row, verdict, findings.price.reference, findings.price.price, priorityText));
    }
  }

  return { candidates, scannedRows, byIssueType };
}

function rowToLeadCandidate(
  release: DatasetRelease,
  row: DatasetRow,
  verdict: RowVerdict,
  baseline: number | null,
  execution: number | null,
  priorityText: string,
): LeadCandidate {
  const code = canonicalCode(row.item_code);
  const item = code ? PRICE_CATALOG[code] : null;
  const institution = institutionFor(row);
  const deltaPct =
    baseline && execution ? Number((((execution - baseline) / baseline) * 100).toFixed(1)) : null;
  const issueLabel = leadTypeFor(verdict.issueType);
  const severityBase = verdict.severity === "high" ? 76 : verdict.severity === "medium" ? 58 : 38;
  const reasons = [
    reasonForIssue(verdict.issueType),
    `${row.region} / ${row.procurement_channel}`,
    `来源：${release.title}`,
  ];
  const watchBoost = watchBoostFor(row, institution);
  if (watchBoost > 0) reasons.push("命中重点对象");
  const userBoost = textBoost(priorityText, [row.item_name, row.item_code, issueLabel, institution, row.procurement_channel]);
  if (userBoost > 0) reasons.push("匹配今日关注");

  return {
    lead_type: issueLabel,
    source_ref_type: "dataset_row",
    source_ref_id: row.id,
    institution_id: institution === "市人民医院" ? "INST-001" : null,
    institution_name_masked: institution,
    region_code: row.region,
    item_code: row.item_code || "待补编码",
    item_name: row.item_name || item?.name || "待补价格项目",
    spec: item?.category ?? null,
    package_unit: item?.unit ?? null,
    baseline_price: baseline,
    execution_price: execution,
    delta_pct: deltaPct,
    priority_score: Math.min(99, severityBase + watchBoost + userBoost + deltaBoost(deltaPct)),
    priority_reasons: reasons,
    evidence_gap: evidenceGapFor(verdict.issueType),
    evidence: {
      release_id: release.id,
      release_title: release.title,
      row_index: row.row_index,
      source_rule: verdict.sourceRule,
      issue: verdict.issueText,
      recommendation: verdict.recommendation,
      confidence: verdict.confidence,
      synthetic_notice: "合成/脱敏演示数据，不能作为真实处置结论。",
    },
    next_action: nextActionFor(verdict.issueType),
    owner_role: ownerFor(verdict.issueType),
    due_at: dueInHours(verdict.severity === "high" ? 4 : 24),
    status: "today_todo",
    human_confirmation_required: 1,
  };
}

function buildFollowUpCandidates(
  tasks: ReturnType<typeof listFollowUpTasks>,
  priorityText: string,
): LeadCandidate[] {
  return tasks.slice(0, 3).map((task, idx) => {
    const userBoost = textBoost(priorityText, ["回访", "补证", task.message_draft]);
    return {
      lead_type: "昨日未回访",
      source_ref_type: "follow_up_task",
      source_ref_id: task.id,
      institution_id: task.assignee_id ?? null,
      institution_name_masked: task.assignee_id === "INST-001" ? "市人民医院" : "待回访机构",
      region_code: null,
      item_code: "FOLLOW-UP",
      item_name: "昨日补证材料未回",
      spec: null,
      package_unit: null,
      baseline_price: null,
      execution_price: null,
      delta_pct: null,
      priority_score: 87 - idx * 3 + userBoost,
      priority_reasons: ["昨日已提醒", "材料未闭环", "影响今日处置判断"],
      evidence_gap: safeJsonArray(task.evidence_required_json),
      evidence: {
        task_id: task.id,
        last_contact_at: task.last_contact_at,
        due_at: task.due_at,
        previous_response: safeJson(task.response_json),
      },
      next_action: "先回访，再决定是否派核验。",
      owner_role: "价格治理岗",
      due_at: dueInHours(2),
      status: "today_todo",
      human_confirmation_required: 1,
    };
  });
}

function buildWatchlistCandidates(
  watchlist: ReturnType<typeof listWatchlist>,
  priorityText: string,
): LeadCandidate[] {
  return watchlist
    .filter((w) => w.watch_type === "complaint")
    .slice(0, 2)
    .map((w) => ({
      lead_type: "投诉关联价格线索",
      source_ref_type: "watchlist",
      source_ref_id: w.id,
      institution_id: null,
      institution_name_masked: w.subject_name_masked,
      region_code: null,
      item_code: w.subject_id ?? "COMPLAINT",
      item_name: w.subject_name_masked,
      spec: null,
      package_unit: null,
      baseline_price: null,
      execution_price: null,
      delta_pct: null,
      priority_score: 62 + Math.round(w.weight * 8) + textBoost(priorityText, ["投诉", w.subject_name_masked]),
      priority_reasons: ["投诉只提高优先级", "需要价格凭证支撑", w.reason],
      evidence_gap: ["价格凭证", "机构执行价截图", "同品种可比口径"],
      evidence: {
        watchlist_id: w.id,
        reason: w.reason,
        boundary: "投诉线索不能单独作为最终处置依据。",
      },
      next_action: "先补价格凭证，再并入同品种核验。",
      owner_role: "市县医保经办",
      due_at: dueInHours(8),
      status: "today_todo",
      human_confirmation_required: 1,
    }));
}

function rankCandidates(
  candidates: LeadCandidate[],
  plan: AgentPlan,
  priorityText: string,
): LeadCandidate[] {
  const focus = plan.issue_focus;
  return candidates
    .map((c) => {
      const focusBoost = focusMatches(c, focus) ? 8 : 0;
      const text = textBoost(priorityText, [c.lead_type, c.item_name, c.institution_name_masked]) / 2;
      return {
        ...c,
        priority_score: Number(Math.min(99, c.priority_score + focusBoost + text).toFixed(1)),
        priority_reasons: focusBoost > 0 ? [...c.priority_reasons, "符合晨会规划重点"] : c.priority_reasons,
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score);
}

function insertLeads(
  db: ReturnType<typeof getDb>,
  sessionId: string,
  leads: LeadCandidate[],
  createdAt: string,
) {
  const stmt = db.prepare(
    `INSERT INTO daily_lead
     (id, session_id, lead_type, source_ref_type, source_ref_id, institution_id, institution_name_masked, region_code, item_code, item_name, spec, package_unit, baseline_price, execution_price, delta_pct, priority_score, priority_reasons_json, evidence_gap_json, evidence_json, next_action, owner_role, owner_id, due_at, status, human_confirmation_required, created_at, updated_at)
     VALUES (:id, :session_id, :lead_type, :source_ref_type, :source_ref_id, :institution_id, :institution_name_masked, :region_code, :item_code, :item_name, :spec, :package_unit, :baseline_price, :execution_price, :delta_pct, :priority_score, :priority_reasons_json, :evidence_gap_json, :evidence_json, :next_action, :owner_role, NULL, :due_at, :status, :human_confirmation_required, :created_at, :updated_at)`,
  );
  const sessionKey = sessionId.replace(/^MOR-/, "").replace(/-/g, "");
  return leads.map((lead, index) => {
    const id = `LEAD-${sessionKey}-${String(index + 1).padStart(2, "0")}`;
    stmt.run({
      id,
      session_id: sessionId,
      lead_type: lead.lead_type,
      source_ref_type: lead.source_ref_type,
      source_ref_id: lead.source_ref_id,
      institution_id: lead.institution_id,
      institution_name_masked: lead.institution_name_masked,
      region_code: lead.region_code,
      item_code: lead.item_code,
      item_name: lead.item_name,
      spec: lead.spec,
      package_unit: lead.package_unit,
      baseline_price: lead.baseline_price,
      execution_price: lead.execution_price,
      delta_pct: lead.delta_pct,
      priority_score: lead.priority_score,
      priority_reasons_json: JSON.stringify(lead.priority_reasons),
      evidence_gap_json: JSON.stringify(lead.evidence_gap),
      evidence_json: JSON.stringify(lead.evidence),
      next_action: lead.next_action,
      owner_role: lead.owner_role,
      due_at: lead.due_at,
      status: lead.status,
      human_confirmation_required: lead.human_confirmation_required,
      created_at: createdAt,
      updated_at: createdAt,
    });
    return { id, ...lead };
  });
}

function insertDefaultFollowUps(
  db: ReturnType<typeof getDb>,
  sessionId: string,
  leads: (LeadCandidate & { id: string })[],
  createdAt: string,
): number {
  const stmt = db.prepare(
    `INSERT INTO follow_up_task
     (id, lead_id, session_id, task_type, assignee_type, assignee_id, evidence_required_json, message_draft, due_at, status, response_json, last_contact_at, created_by, created_at, updated_at)
     VALUES (:id, :lead_id, :session_id, :task_type, :assignee_type, :assignee_id, :evidence_required_json, :message_draft, :due_at, :status, :response_json, :last_contact_at, :created_by, :created_at, :updated_at)`,
  );
  const sessionKey = sessionId.replace(/^MOR-/, "").replace(/-/g, "");
  let count = 0;
  for (const lead of leads.slice(0, 3)) {
    if (lead.evidence_gap.length === 0) continue;
    count += 1;
    stmt.run({
      id: `FUP-${sessionKey}-${String(count).padStart(2, "0")}`,
      lead_id: lead.id,
      session_id: sessionId,
      task_type: lead.next_action.includes("核验") ? "核验" : "补证",
      assignee_type: lead.institution_id ? "institution" : "internal_role",
      assignee_id: lead.institution_id ?? lead.owner_role,
      evidence_required_json: JSON.stringify(lead.evidence_gap),
      message_draft: lead.next_action,
      due_at: lead.due_at,
      status: "open",
      response_json: JSON.stringify({ created_from: "morning_session" }),
      last_contact_at: null,
      created_by: "价序",
      created_at: createdAt,
      updated_at: createdAt,
    });
  }
  return count;
}

function insertMorningSession(
  db: ReturnType<typeof getDb>,
  s: {
    id: string;
    sessionDate: string;
    orgScope: string;
    openedBy: string;
    sourceCutoffAt: string;
    priorityInput: Record<string, unknown>;
    status: string;
    leadCount: number;
    statusSummary: Record<string, unknown>;
    daybookSummary: Record<string, unknown>;
    agentRunId: string | null;
    openedAt: string | null;
    createdAt: string;
  },
) {
  db.prepare(
    `INSERT INTO morning_session
     (id, session_date, org_scope, opened_by, source_cutoff_at, priority_input_json, plan_version, status, lead_count, status_summary_json, daybook_summary_json, agent_run_id, opened_at, closed_at, created_at, updated_at)
     VALUES (:id, :session_date, :org_scope, :opened_by, :source_cutoff_at, :priority_input_json, :plan_version, :status, :lead_count, :status_summary_json, :daybook_summary_json, :agent_run_id, :opened_at, NULL, :created_at, :updated_at)`,
  ).run({
    id: s.id,
    session_date: s.sessionDate,
    org_scope: s.orgScope,
    opened_by: s.openedBy,
    source_cutoff_at: s.sourceCutoffAt,
    priority_input_json: JSON.stringify(s.priorityInput),
    plan_version: 1,
    status: s.status,
    lead_count: s.leadCount,
    status_summary_json: JSON.stringify(s.statusSummary),
    daybook_summary_json: JSON.stringify(s.daybookSummary),
    agent_run_id: s.agentRunId,
    opened_at: s.openedAt,
    created_at: s.createdAt,
    updated_at: s.createdAt,
  });
}

function updateSession(
  db: ReturnType<typeof getDb>,
  sessionId: string,
  patch: {
    status: string;
    leadCount: number;
    agentRunId: string;
    statusSummary: Record<string, unknown>;
    daybookSummary: Record<string, unknown>;
  },
) {
  db.prepare(
    `UPDATE morning_session
     SET status = :status, lead_count = :lead_count, status_summary_json = :status_summary_json,
         daybook_summary_json = :daybook_summary_json, agent_run_id = :agent_run_id, updated_at = :updated_at
     WHERE id = :id`,
  ).run({
    id: sessionId,
    status: patch.status,
    lead_count: patch.leadCount,
    status_summary_json: JSON.stringify(patch.statusSummary),
    daybook_summary_json: JSON.stringify(patch.daybookSummary),
    agent_run_id: patch.agentRunId,
    updated_at: new Date().toISOString(),
  });
}

function insertRun(
  db: ReturnType<typeof getDb>,
  r: {
    runId: string;
    sessionId: string;
    inputSummary: string;
    candidate: Record<string, unknown>;
    plan: AgentPlan;
    tools: ToolCall[];
    resultState: ReleaseState;
    status: RunStatus;
    errorCategory: string | null;
    outputHash: string;
    durationMs: number;
    startedIso: string;
    finishedIso: string;
    providerMeta?: Record<string, unknown>;
  },
) {
  db.prepare(
    `INSERT INTO agent_run (id, release_id, mutation_type, input_summary, candidate_json, plan_json, tools_json, result_state, before_state, after_state, provider_meta_json, status, error_category, output_hash, duration_ms, started_at, finished_at)
     VALUES (:id, :release_id, :mutation_type, :input_summary, :candidate_json, :plan_json, :tools_json, :result_state, :before_state, :after_state, :provider_meta_json, :status, :error_category, :output_hash, :duration_ms, :started_at, :finished_at)`,
  ).run({
    id: r.runId,
    release_id: r.sessionId,
    mutation_type: SESSION_KIND,
    input_summary: r.inputSummary,
    candidate_json: JSON.stringify(r.candidate),
    plan_json: JSON.stringify(r.plan),
    tools_json: JSON.stringify(r.tools),
    result_state: r.resultState,
    before_state: "待治理",
    after_state: r.resultState,
    provider_meta_json: JSON.stringify(r.providerMeta ?? { source: "degraded" }),
    status: r.status,
    error_category: r.errorCategory,
    output_hash: r.outputHash,
    duration_ms: r.durationMs,
    started_at: r.startedIso,
    finished_at: r.finishedIso,
  });
}

function insertReplay(db: ReturnType<typeof getDb>, runId: string, sessionId: string, events: ReplayEvent[]) {
  db.prepare(
    `INSERT INTO replay_timeline (id, run_id, release_id, events_json, created_at)
     VALUES (:id, :run_id, :release_id, :events_json, :created_at)`,
  ).run({
    id: `RPL-${runId}`,
    run_id: runId,
    release_id: sessionId,
    events_json: JSON.stringify(events),
    created_at: new Date().toISOString(),
  });
}

function morningTools(leadCount: number, taskCount: number): ToolCall[] {
  return [
    tool("source_reader", "来源读取", "批次/重点/回访", "来源摘要已读取", true),
    tool("issue_ranker", "线索排序", `${leadCount} 条候选`, "按风险、时限、重点对象、投诉、关注点排序", true),
    tool("lead_writer", "线索写入", `${leadCount} 条`, `写入 ${leadCount} 条 daily_lead`, true),
    tool("follow_up_writer", "待办写入", `${taskCount} 条`, `写入 ${taskCount} 条 follow_up_task`, true),
    tool("replay_builder", "回放组装", SESSION_KIND, "replay_timeline 已组装", true),
  ];
}

function tool(toolName: string, label: string, input: string, output: string, ok: boolean): ToolCall {
  return { tool: toolName, label, input, output: `${output} → ${ok ? "ok" : "issue"}`, ok };
}

function sourceSummary(
  releases: DatasetRelease[],
  scannedRows: number,
  watchlistCount: number,
  overdueFollowUpCount: number,
) {
  return {
    release_count: releases.length,
    scanned_rows: scannedRows,
    watchlist_count: watchlistCount,
    overdue_follow_up_count: overdueFollowUpCount,
    newest_release: releases[0]?.id ?? null,
    source_note: "价格批次与重点对象为合成/脱敏演示数据。",
  };
}

function summarizeLeads(leads: LeadCandidate[]) {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const lead of leads) {
    byType[lead.lead_type] = (byType[lead.lead_type] ?? 0) + 1;
    byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1;
  }
  return {
    state: "planned",
    total: leads.length,
    by_type: byType,
    by_status: byStatus,
    human_boundary: "形成发函、通报、关闭、违规认定前必须人工确认。",
  };
}

function degradedPlan(message: string): AgentPlan {
  return {
    issue_focus: "none",
    ordered_tools: [],
    rationale: message,
    expected_state: "检查失败",
    source: "degraded",
  };
}

function normalizeReleaseState(expected: string, leads: LeadCandidate[]): ReleaseState {
  if (["异常处置", "纠错候选", "可落地", "需核验", "检查失败", "待治理", "监测中"].includes(expected)) {
    return expected as ReleaseState;
  }
  if (leads.some((x) => x.lead_type.includes("异常"))) return "异常处置";
  if (leads.some((x) => x.lead_type.includes("目录"))) return "纠错候选";
  return "需核验";
}

function canonicalCode(code: string): string | null {
  const trimmed = code.trim();
  if (PRICE_CATALOG[trimmed]) return trimmed;
  return CODE_ALIASES[trimmed] ?? null;
}

function institutionFor(row: DatasetRow): string {
  if (row.row_index % 5 === 0) return "市人民医院";
  if (row.row_index % 5 === 1) return "省立医院";
  if (row.row_index % 5 === 2) return "区中心医院";
  if (row.row_index % 5 === 3) return "第一人民医院";
  return "基层医疗机构";
}

function leadTypeFor(issueType: string): string {
  if (["collective_not_landed", "collective_price_overrun", "procurement_channel_unknown"].includes(issueType)) return "集采价格落地差异";
  if (["price_over_ceiling", "price_invalid"].includes(issueType)) return "机构执行价异常";
  if (issueType === "price_spike") return "参考价涨幅核验";
  if (issueType === "item_code_correctable") return "目录别名待确认";
  if (issueType === "item_catalog_miss") return "目录硬未命中";
  if (issueType === "date_anomaly") return "来源时点异常";
  return "价格线索待核";
}

function reasonForIssue(issueType: string): string {
  const map: Record<string, string> = {
    collective_not_landed: "集采区域落地不一致",
    collective_price_overrun: "执行价高于中选价容忍阈值",
    procurement_channel_unknown: "采购渠道不在策略内",
    price_over_ceiling: "高于最高有效价",
    price_invalid: "单价格式异常",
    price_spike: "参考价涨幅超过阈值",
    item_code_correctable: "编码可按目录别名纠错",
    item_catalog_miss: "编码未命中目录",
    date_anomaly: "价格日期晚于监测日",
    schema_field_missing: "价格字段缺失",
  };
  return map[issueType] ?? "价格治理规则命中";
}

function evidenceGapFor(issueType: string): string[] {
  if (issueType.startsWith("collective_")) return ["省平台落地截图", "医疗机构执行价凭证", "规格/包装单位口径"];
  if (["price_over_ceiling", "price_spike", "price_invalid"].includes(issueType)) return ["HIS 执行价截图", "订单或发票摘要", "政策调价依据"];
  if (issueType.includes("catalog") || issueType.includes("code")) return ["目录维护确认", "标准编码依据"];
  if (issueType.includes("date") || issueType.includes("schema")) return ["来源系统推送时间", "字段补正说明"];
  return ["价格凭证", "机构说明"];
}

function nextActionFor(issueType: string): string {
  if (["price_over_ceiling", "collective_price_overrun", "item_catalog_miss", "date_anomaly", "schema_field_missing"].includes(issueType)) {
    return "先退回补证，补齐后再决定是否转异常处置。";
  }
  if (["collective_not_landed", "procurement_channel_unknown", "price_spike"].includes(issueType)) {
    return "派核验岗确认落地口径或调价依据。";
  }
  if (issueType === "item_code_correctable") return "请目录维护员确认别名映射后重跑监测。";
  return "纳入今日观察，等待补充材料。";
}

function ownerFor(issueType: string): string {
  if (issueType.startsWith("collective_")) return "集采落地专班";
  if (issueType.includes("catalog") || issueType.includes("code")) return "目录维护员";
  if (issueType.includes("price")) return "价格核验人";
  return "价格治理岗";
}

function watchBoostFor(row: DatasetRow, institution: string): number {
  let boost = 0;
  if (institution === "市人民医院") boost += 10;
  if (canonicalCode(row.item_code) === "HC-STN-901") boost += 8;
  return boost;
}

function textBoost(text: string, needles: Array<string | null | undefined>): number {
  if (!text.trim()) return 0;
  const hay = text.toLowerCase();
  let score = 0;
  for (const raw of needles) {
    const n = String(raw ?? "").trim().toLowerCase();
    if (n && hay.includes(n)) score += 6;
  }
  if (hay.includes("集采") && needles.some((x) => String(x ?? "").includes("集采"))) score += 5;
  if (hay.includes("回访") && needles.some((x) => String(x ?? "").includes("回访"))) score += 5;
  return Math.min(score, 14);
}

function deltaBoost(delta: number | null): number {
  if (delta === null) return 0;
  if (delta > 25) return 8;
  if (delta > 15) return 5;
  return 0;
}

function focusMatches(candidate: LeadCandidate, focus: string): boolean {
  const text = `${candidate.lead_type} ${candidate.next_action}`;
  if (focus === "collective_landing") return text.includes("集采");
  if (focus === "institution_execution") return text.includes("执行价") || text.includes("补证");
  if (focus === "price_spike") return text.includes("涨幅") || text.includes("参考价");
  if (focus === "evidence_gap") return candidate.evidence_gap.length > 0;
  if (focus === "overdue_follow_up") return candidate.lead_type.includes("回访");
  if (focus === "catalog_standardization") return text.includes("目录");
  return false;
}

function dueInHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function hashOutput(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function safeJsonArray(text: string): string[] {
  const parsed = safeJson(text);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function focusLabel(focus: string): string {
  const labels: Record<string, string> = {
    collective_landing: "集采落地",
    institution_execution: "机构执行价",
    price_spike: "参考价涨幅",
    evidence_gap: "补证缺口",
    overdue_follow_up: "超期回访",
    catalog_standardization: "目录标化",
  };
  return labels[focus] ?? focus;
}
