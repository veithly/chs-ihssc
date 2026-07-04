import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { getDb } from "../db";
import {
  getAccessSnapshot,
  getManifest,
  getRelease,
  getRows,
  updateReleaseState,
} from "../repo";
import { generateAgentPlan } from "../provider";
import {
  VALIDATORS,
  aggregateState,
  classifyRow,
  type CandidateRow,
} from "./tools";
import type {
  AgentPlan,
  BatchStats,
  ReleaseState,
  ReplayEvent,
  RunStatus,
  ToolCall,
} from "../types";

export interface RunInput {
  releaseId: string;
}

export interface RunResult {
  ok: boolean;
  runId: string | null;
  releaseId: string;
  state: ReleaseState;
  status: RunStatus;
  error_category?: string;
  message?: string;
  output_hash?: string;
}

const SCAN_KIND = "batch_scan";

export async function runReleaseGateAgent(input: RunInput): Promise<RunResult> {
  const db = getDb();
  const started = new Date();
  const startedIso = started.toISOString();
  const runId = `RUN-${started.toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6)}`;

  const release = getRelease(input.releaseId);
  if (!release) {
    return {
      ok: false,
      runId: null,
      releaseId: input.releaseId,
      state: "检查失败",
      status: "failed",
      error_category: "release_not_found",
      message: "未找到该价格批次。",
    };
  }

  const beforeState = release.state;
  const rows = getRows(release.id);
  if (rows.length === 0) {
    return {
      ok: false,
      runId: null,
      releaseId: release.id,
      state: "检查失败",
      status: "failed",
      error_category: "empty_batch",
      message: "该批次没有可监测的价格行。",
    };
  }

  const manifest = getManifest(release.id);
  const accessSnapshot = getAccessSnapshot(release.id);

  // ---- Observe (whole batch) ----
  const sample = rows.slice(0, 12).map((r) => ({
    row_index: r.row_index,
    item_code: r.item_code,
    item_name: r.item_name,
    price_date: r.price_date,
    procurement_channel: r.procurement_channel,
    region: r.region,
    unit_price: r.unit_price,
  }));
  const observation = {
    release: {
      id: release.id,
      domain: release.domain,
      release_date: release.release_date,
      record_count: release.record_count,
    },
    scanned_rows: rows.length,
    sample_rows: sample,
    schema_version: manifest?.schema_version,
    code_dictionary_version: manifest?.code_dictionary_version,
    procurement_channel_version: manifest?.procurement_channel_version,
    release_rules: [
      "价格日期不得晚于批次监测日",
      "医保项目编码必须命中价格目录，别名编码进入纠错候选",
      "单价不得超过最高有效价或集采中选价容忍阈值",
      "集采中选价必须在已落地区域内落地",
      "参考价涨幅超过阈值需核验",
      "机构价不得高于零售「即时达」集中价 1.3 倍",
      "同通用名不同包装按差比价折算后比价（2452号）",
    ],
  };

  const replay: ReplayEvent[] = [];
  const tNow = () => new Date().toISOString();
  replay.push({
    phase: "observe",
    title: "observe 观察",
    detail: `读取价格批次、目录版本、治理策略与整批 ${rows.length} 行（抽样 ${sample.length} 行交规划器参考）。`,
    at: tNow(),
    ok: true,
  });

  // ---- Plan (LIVE provider, on the critical path) ----
  const planResult = await generateAgentPlan(observation);

  if (!planResult.ok) {
    // ---- Recover: degraded run, no fake success ----
    replay.push({
      phase: "recover",
      title: "recover 降级",
      detail: `Provider 不可用（${planResult.category}）：${planResult.message} 不输出任何 Agent 结论，治理状态置为检查失败。`,
      at: tNow(),
      ok: false,
    });
    const finishedIso = new Date().toISOString();
    const providerMeta = {
      source: "degraded",
      category: planResult.category,
      ...(planResult.meta ?? {}),
    };
    const outputHash = createHash("sha256")
      .update(JSON.stringify({ runId, degraded: planResult.category }))
      .digest("hex")
      .slice(0, 16);

    insertRun(db, {
      runId,
      releaseId: release.id,
      scanKind: SCAN_KIND,
      inputSummary: `整批扫描 ${rows.length} 行（provider 降级）`,
      candidate: emptyStats(rows.length),
      plan: {
        issue_focus: "none",
        ordered_tools: [],
        rationale: planResult.message,
        expected_state: "检查失败",
        source: "degraded",
      },
      tools: [],
      resultState: "检查失败",
      beforeState,
      afterState: "检查失败",
      providerMeta,
      status: "degraded",
      errorCategory: planResult.category,
      outputHash,
      durationMs: Date.now() - started.getTime(),
      startedIso,
      finishedIso,
    });
    insertReplay(db, runId, release.id, replay);
    updateReleaseState(release.id, "检查失败", runId);

    return {
      ok: false,
      runId,
      releaseId: release.id,
      state: "检查失败",
      status: "degraded",
      error_category: planResult.category,
      message: planResult.message,
      output_hash: outputHash,
    };
  }

  const plan: AgentPlan = planResult.plan;
  replay.push({
    phase: "plan",
    title: "plan 计划",
    detail: `重点=${plan.issue_focus}；预计=${plan.expected_state}。${plan.rationale}`,
    at: tNow(),
    ok: true,
  });

  // ---- Tools: scan EVERY row with the deterministic validators ----
  const createdIso = new Date().toISOString();
  const byState: Record<string, number> = {
    可落地: 0,
    纠错候选: 0,
    异常处置: 0,
    需核验: 0,
  };
  const byIssueType: Record<string, number> = {};
  const affected: number[] = [];
  // finding-level counters for an honest tool trace
  let schemaMiss = 0;
  let catalogCorrectable = 0;
  let catalogMiss = 0;
  let priceOverCeiling = 0;
  let priceSpike = 0;
  let collectiveNotLanded = 0;
  let collectiveOverrun = 0;
  let channelUnknown = 0;
  let retailOver = 0;
  let retailNoCode = 0;
  let specOverRatio = 0;
  let dateAnomaly = 0;
  let corrections = 0;
  let quarantines = 0;
  let approvals = 0;

  const insIssue = db.prepare(
    `INSERT INTO row_issue (id, run_id, release_id, row_id, row_index, type, severity, detected_fields, source_rule, confidence, status, created_at)
     VALUES (:id, :run_id, :release_id, :row_id, :row_index, :type, :severity, :detected_fields, :source_rule, :confidence, :status, :created_at)`,
  );
  const insCorrection = db.prepare(
    `INSERT INTO correction_proposal (id, run_id, release_id, row_id, issue_id, field, before_value, after_value, source_dictionary, rationale, confidence, status, created_at)
     VALUES (:id, :run_id, :release_id, :row_id, :issue_id, :field, :before_value, :after_value, :source_dictionary, :rationale, :confidence, :status, :created_at)`,
  );
  const insQuarantine = db.prepare(
    `INSERT INTO quarantine_item (id, run_id, release_id, row_id, issue_id, reason, impact, review_status, created_at)
     VALUES (:id, :run_id, :release_id, :row_id, :issue_id, :reason, :impact, :review_status, :created_at)`,
  );
  const insApproval = db.prepare(
    `INSERT INTO release_approval (id, run_id, release_id, row_id, issue_id, status, reason, policy_snapshot, approver, human_notes, decided_at, created_at)
     VALUES (:id, :run_id, :release_id, :row_id, :issue_id, :status, :reason, :policy_snapshot, NULL, NULL, NULL, :created_at)`,
  );

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

    // Finding-level tallies. A blank required field is a schema issue, not a
    // catalog miss, so catalog counting is gated on schema passing.
    if (!findings.schema.ok) schemaMiss += 1;
    else if (!findings.standard.valid && !(findings.retail.isRetailChannel && findings.retail.noCode)) {
      // 零售无编码行不算目录未命中——它走 R6 名称对应，由 retail 计数器单独统计
      if (findings.standard.correctable) catalogCorrectable += 1;
      else catalogMiss += 1;
    }
    if (findings.price.overCeiling) priceOverCeiling += 1;
    if (findings.price.spike) priceSpike += 1;
    if (findings.collective.notLanded) collectiveNotLanded += 1;
    if (findings.collective.overCollective) collectiveOverrun += 1;
    if (!findings.collective.channelKnown) channelUnknown += 1;
    if (findings.retail.over) retailOver += 1;
    if (findings.retail.isRetailChannel && findings.retail.noCode) retailNoCode += 1;
    if (findings.specRatio.over) specOverRatio += 1;
    if (findings.anomaly.anomaly) dateAnomaly += 1;

    byState[verdict.state] = (byState[verdict.state] ?? 0) + 1;
    if (verdict.issueType) {
      byIssueType[verdict.issueType] = (byIssueType[verdict.issueType] ?? 0) + 1;
      affected.push(row.row_index);
    }

    if (!verdict.writer) continue;

    const issueId = `ISS-${randomUUID().slice(0, 8)}`;
    insIssue.run({
      id: issueId,
      run_id: runId,
      release_id: release.id,
      row_id: row.id,
      row_index: row.row_index,
      type: verdict.issueType,
      severity: verdict.severity,
      detected_fields: JSON.stringify(verdict.detectedFields),
      source_rule: verdict.sourceRule,
      confidence: verdict.confidence,
      status: "open",
      created_at: createdIso,
    });

    if (verdict.writer === "correction") {
      corrections += 1;
      insCorrection.run({
        id: `COR-${randomUUID().slice(0, 8)}`,
        run_id: runId,
        release_id: release.id,
        row_id: row.id,
        issue_id: issueId,
        field: "item_code",
        before_value: row.item_code,
        after_value: verdict.suggestion ?? "",
        source_dictionary: manifest?.code_dictionary_version ?? "price-catalog",
        rationale:
          verdict.issueType === "retail_price_no_code"
            ? `零售渠道无编码，按名称对应目录：「${row.item_name}」 → ${verdict.suggestion}（R6，回写需人工确认）`
            : `价格目录高置信别名映射：${row.item_code} → ${verdict.suggestion}`,
        confidence: verdict.confidence,
        status: "pending",
        created_at: createdIso,
      });
    } else if (verdict.writer === "quarantine") {
      quarantines += 1;
      insQuarantine.run({
        id: `QAR-${randomUUID().slice(0, 8)}`,
        run_id: runId,
        release_id: release.id,
        row_id: row.id,
        issue_id: issueId,
        reason: verdict.issueText,
        impact: "该价格记录若落地将影响挂网价监测、集采执行跟踪与异常预警。",
        review_status: "in_disposal",
        created_at: createdIso,
      });
    } else if (verdict.writer === "approval") {
      approvals += 1;
      insApproval.run({
        id: `APR-${randomUUID().slice(0, 8)}`,
        run_id: runId,
        release_id: release.id,
        row_id: row.id,
        issue_id: issueId,
        status: "pending",
        reason: verdict.issueText,
        policy_snapshot: accessSnapshot?.rules_json ?? "{}",
        created_at: createdIso,
      });
    }
  }

  const scanned = rows.length;
  const issues = affected.length;
  const clean = byState["可落地"] ?? 0;
  const state = aggregateState(byState);

  // ---- Aggregate tool trace (one entry per validator + writers) ----
  const toolCalls: ToolCall[] = [
    tool(
      "schema_mapper",
      "字段标化",
      `必填字段 × ${scanned} 行（零售渠道 item_code 豁免）`,
      `字段完整 ${scanned - schemaMiss} / 缺失 ${schemaMiss}`,
      schemaMiss === 0,
      schemaMiss ? "schema_field_missing" : undefined,
    ),
    tool(
      "price_catalog_standardizer",
      "价格目录标化",
      `item_code × ${scanned} 行`,
      `命中 ${scanned - catalogCorrectable - catalogMiss} / 未命中 ${catalogCorrectable + catalogMiss}（可纠错 ${catalogCorrectable} · 硬未命中 ${catalogMiss}）`,
      catalogCorrectable + catalogMiss === 0,
      catalogMiss
        ? "item_catalog_miss"
        : catalogCorrectable
          ? "item_code_correctable"
          : undefined,
    ),
    tool(
      "reference_price_monitor",
      "参考价动态监测",
      `unit_price × ${scanned} 行`,
      `正常 ${scanned - priceOverCeiling - priceSpike} / 超最高有效价 ${priceOverCeiling} / 涨幅核验 ${priceSpike}`,
      priceOverCeiling + priceSpike === 0,
      priceOverCeiling ? "price_over_ceiling" : priceSpike ? "price_spike" : undefined,
    ),
    tool(
      "collective_landing_tracker",
      "集采落地跟踪",
      `channel+region+unit_price × ${scanned} 行`,
      `落地正常 ${scanned - collectiveNotLanded - collectiveOverrun - channelUnknown} / 未落地 ${collectiveNotLanded} / 超中选价 ${collectiveOverrun} / 未知渠道 ${channelUnknown}`,
      collectiveNotLanded + collectiveOverrun + channelUnknown === 0,
      collectiveOverrun
        ? "collective_price_overrun"
        : collectiveNotLanded
          ? "collective_not_landed"
          : channelUnknown
            ? "procurement_channel_unknown"
            : undefined,
    ),
    tool(
      "retail_price_comparator",
      "零售集中价比对",
      `retail_price×1.3 与名称对应 × ${scanned} 行`,
      `超 1.3 倍上限 ${retailOver} / 零售无编码待对应 ${retailNoCode} / 其余通过`,
      retailOver + retailNoCode === 0,
      retailOver ? "retail_over_1p3x" : retailNoCode ? "retail_price_no_code" : undefined,
    ),
    tool(
      "spec_ratio_comparator",
      "差比价折算",
      `K=1.95^log₂X 折算可比价 × ${scanned} 行（2452号）`,
      `差比价超限 ${specOverRatio} / 其余合规或不适用`,
      specOverRatio === 0,
      specOverRatio ? "spec_over_ratio" : undefined,
    ),
    tool(
      "anomaly_profiler",
      "异常画像",
      `price_date × ${scanned} 行（监测日 ${release.release_date}）`,
      `正常 ${scanned - dateAnomaly} / 日期异常 ${dateAnomaly}`,
      dateAnomaly === 0,
      dateAnomaly ? "date_anomaly" : undefined,
    ),
  ];
  if (corrections > 0)
    toolCalls.push(tool("correction_writer", "纠错提案写入", `${corrections} 行可纠错`, `写入 ${corrections} 条 correction_proposal(pending)`, true));
  if (quarantines > 0)
    toolCalls.push(tool("quarantine_writer", "异常处置写入", `${quarantines} 行硬异常`, `写入 ${quarantines} 条 quarantine_item(in_disposal)`, true));
  if (approvals > 0)
    toolCalls.push(tool("approval_router", "核验任务路由", `${approvals} 行需业务核验`, `写入 ${approvals} 条 release_approval(pending)`, true));
  toolCalls.push(tool("replay_builder", "回放组装", `run=${runId}`, "replay_timeline 已组装", true));

  replay.push({
    phase: "tools",
    title: "tools 工具调用",
    detail: `${VALIDATORS.length} 个确定性工具 × ${scanned} 行 = ${scanned * VALIDATORS.length} 次校验；命中问题 ${issues} 处（异常处置 ${byState["异常处置"]} · 需核验 ${byState["需核验"]} · 纠错候选 ${byState["纠错候选"]}）。`,
    at: tNow(),
    ok: true,
  });

  replay.push({
    phase: "mutate",
    title: "mutate 状态变更",
    detail: `写入 ${issues} 条 row_issue（纠错 ${corrections} · 异常处置 ${quarantines} · 核验 ${approvals}）；governance_state ${beforeState} → ${state}。`,
    at: tNow(),
    ok: true,
  });

  updateReleaseState(release.id, state, runId);
  const verified = getRelease(release.id);
  replay.push({
    phase: "verify",
    title: "verify 验证",
    detail: `重新读取治理状态：${verified?.state}；${clean} 行可落地、${issues} 行进入闭环，证据已持久化（agent_run + row_issue + replay_timeline）。`,
    at: tNow(),
    ok: verified?.state === state,
  });

  const stats: BatchStats = {
    total_rows: release.record_count,
    scanned,
    validations: scanned * VALIDATORS.length,
    clean,
    issues,
    by_state: {
      可落地: byState["可落地"] ?? 0,
      纠错候选: byState["纠错候选"] ?? 0,
      异常处置: byState["异常处置"] ?? 0,
      需核验: byState["需核验"] ?? 0,
    },
    by_issue_type: byIssueType,
    affected_row_indexes: affected,
    validators: VALIDATORS.length,
  };

  const finishedIso = new Date().toISOString();
  const durationMs = Date.now() - started.getTime();
  const outputHash = createHash("sha256")
    .update(
      JSON.stringify({
        release: release.id,
        scanned,
        by_state: stats.by_state,
        by_issue_type: byIssueType,
        focus: plan.issue_focus,
        state,
      }),
    )
    .digest("hex")
    .slice(0, 16);

  const providerMeta = { source: "live-provider", ...planResult.meta };

  insertRun(db, {
    runId,
    releaseId: release.id,
    scanKind: SCAN_KIND,
    inputSummary: `整批扫描 ${scanned} 行 → ${issues} 处问题`,
    candidate: stats as unknown as Record<string, unknown>,
    plan,
    tools: toolCalls,
    resultState: state,
    beforeState,
    afterState: state,
    providerMeta,
    status: "success",
    errorCategory: null,
    outputHash,
    durationMs,
    startedIso,
    finishedIso,
  });
  insertReplay(db, runId, release.id, replay);

  return {
    ok: true,
    runId,
    releaseId: release.id,
    state,
    status: "success",
    output_hash: outputHash,
  };
}

function tool(
  toolName: string,
  label: string,
  input: string,
  output: string,
  ok: boolean,
  finding?: string,
): ToolCall {
  return { tool: toolName, label, input, output: `${output} → ${ok ? "ok" : "issue"}`, ok, finding };
}

function emptyStats(total: number): Record<string, unknown> {
  const s: BatchStats = {
    total_rows: total,
    scanned: 0,
    validations: 0,
    clean: 0,
    issues: 0,
    by_state: { 可落地: 0, 纠错候选: 0, 异常处置: 0, 需核验: 0 },
    by_issue_type: {},
    affected_row_indexes: [],
    validators: VALIDATORS.length,
  };
  return s as unknown as Record<string, unknown>;
}

function insertRun(
  db: ReturnType<typeof getDb>,
  r: {
    runId: string;
    releaseId: string;
    scanKind: string;
    inputSummary: string;
    candidate: Record<string, unknown>;
    plan: AgentPlan;
    tools: ToolCall[];
    resultState: ReleaseState;
    beforeState: ReleaseState;
    afterState: ReleaseState;
    providerMeta: Record<string, unknown>;
    status: RunStatus;
    errorCategory: string | null;
    outputHash: string;
    durationMs: number;
    startedIso: string;
    finishedIso: string;
  },
) {
  db.prepare(
    `INSERT INTO agent_run (id, release_id, mutation_type, input_summary, candidate_json, plan_json, tools_json, result_state, before_state, after_state, provider_meta_json, status, error_category, output_hash, duration_ms, started_at, finished_at)
     VALUES (:id, :release_id, :mutation_type, :input_summary, :candidate_json, :plan_json, :tools_json, :result_state, :before_state, :after_state, :provider_meta_json, :status, :error_category, :output_hash, :duration_ms, :started_at, :finished_at)`,
  ).run({
    id: r.runId,
    release_id: r.releaseId,
    mutation_type: r.scanKind,
    input_summary: r.inputSummary,
    candidate_json: JSON.stringify(r.candidate),
    plan_json: JSON.stringify(r.plan),
    tools_json: JSON.stringify(r.tools),
    result_state: r.resultState,
    before_state: r.beforeState,
    after_state: r.afterState,
    provider_meta_json: JSON.stringify(r.providerMeta),
    status: r.status,
    error_category: r.errorCategory,
    output_hash: r.outputHash,
    duration_ms: r.durationMs,
    started_at: r.startedIso,
    finished_at: r.finishedIso,
  });
}

function insertReplay(
  db: ReturnType<typeof getDb>,
  runId: string,
  releaseId: string,
  events: ReplayEvent[],
) {
  db.prepare(
    `INSERT INTO replay_timeline (id, run_id, release_id, events_json, created_at)
     VALUES (:id, :run_id, :release_id, :events_json, :created_at)`,
  ).run({
    id: `RPL-${runId}`,
    run_id: runId,
    release_id: releaseId,
    events_json: JSON.stringify(events),
    created_at: new Date().toISOString(),
  });
}
