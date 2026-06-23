import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { getDb } from "../db";
import {
  getAccessSnapshot,
  getManifest,
  getRelease,
  getRow,
  getRows,
  updateReleaseState,
} from "../repo";
import { generateAgentPlan } from "../provider";
import {
  accessPolicyEvaluator,
  anomalyProfiler,
  codeDictionaryValidator,
  schemaMapper,
  tokenizedIdentityMatcher,
  type CandidateRow,
} from "./tools";
import type {
  AgentPlan,
  MutationType,
  ReleaseState,
  ReplayEvent,
  RunStatus,
  ToolCall,
} from "../types";

export interface RunInput {
  releaseId: string;
  rowId?: string;
  mutationType: MutationType;
  override?: Partial<
    Pick<
      CandidateRow,
      | "catalog_code"
      | "service_date"
      | "person_token"
      | "requester_role"
      | "purpose"
    >
  >;
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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function applyMutation(
  base: CandidateRow,
  mutationType: MutationType,
  releaseDate: string,
  override?: RunInput["override"],
): { candidate: CandidateRow; summary: string } {
  const candidate: CandidateRow = { ...base };
  let summary = "";
  switch (mutationType) {
    case "wrong_code":
      candidate.catalog_code = override?.catalog_code ?? "I1O";
      summary = `变更类型=错误编码；catalog_code=${candidate.catalog_code}`;
      break;
    case "future_date":
      candidate.service_date = override?.service_date ?? addDays(releaseDate, 7);
      summary = `变更类型=未来日期；service_date=${candidate.service_date}`;
      break;
    case "identity_conflict":
      candidate.person_token =
        override?.person_token ?? base.person_token.slice(0, 6) + "*******0001";
      summary = `变更类型=身份冲突；person_token=${candidate.person_token}`;
      break;
    case "access_denied":
      candidate.requester_role = override?.requester_role ?? "外部分析员";
      candidate.purpose = override?.purpose ?? "对外共享";
      summary = `变更类型=权限拒绝；role=${candidate.requester_role}, purpose=${candidate.purpose}`;
      break;
    default:
      summary = "变更类型=无（基线校验）";
  }
  return { candidate, summary };
}

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
      message: "未找到该发布批次。",
    };
  }

  const beforeState = release.state;
  const rows = getRows(release.id);
  const baseRow =
    (input.rowId ? getRow(input.rowId) : null) ??
    rows.find((r) => r.row_index === 2) ??
    rows[0];
  if (!baseRow) {
    return {
      ok: false,
      runId: null,
      releaseId: release.id,
      state: "检查失败",
      status: "failed",
      error_category: "row_not_found",
      message: "该批次没有可校验的数据行。",
    };
  }

  const manifest = getManifest(release.id);
  const accessSnapshot = getAccessSnapshot(release.id);

  const { candidate, summary } = applyMutation(
    {
      person_token: baseRow.person_token,
      catalog_code: baseRow.catalog_code,
      service_date: baseRow.service_date,
      access_policy: baseRow.access_policy,
      requester_role: baseRow.requester_role,
      purpose: baseRow.purpose,
    },
    input.mutationType,
    release.release_date,
    input.override,
  );

  // ---- Observe ----
  const observation = {
    release: {
      id: release.id,
      domain: release.domain,
      release_date: release.release_date,
      record_count: release.record_count,
    },
    selected_row: candidate,
    schema_version: manifest?.schema_version,
    code_dictionary_version: manifest?.code_dictionary_version,
    access_policy_version: manifest?.access_policy_version,
    release_rules: [
      "服务日期不得晚于发布日",
      "病种编码必须命中医保目录字典",
      "人员标识必须唯一命中身份注册表",
      "访问角色与用途必须满足访问策略",
    ],
  };

  const replay: ReplayEvent[] = [];
  const tNow = () => new Date().toISOString();
  replay.push({
    phase: "observe",
    title: "observe 观察",
    detail: `读取发布元数据、抽样行与源清单：${summary}`,
    at: tNow(),
    ok: true,
  });

  // ---- Plan (LIVE provider, on the critical path) ----
  const planResult = await generateAgentPlan(observation);

  if (!planResult.ok) {
    // ---- Recover: degraded / failed run, no fake success ----
    replay.push({
      phase: "recover",
      title: "recover 降级",
      detail: `Provider 不可用（${planResult.category}）：${planResult.message} 不输出任何 Agent 结论，发布状态置为检查失败。`,
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
      mutationType: input.mutationType,
      inputSummary: summary,
      candidate: { row_index: baseRow.row_index, ...candidate },
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

  // ---- Tools: run every release rule (live plan orders them) + safety backstop ----
  const runners: Record<string, () => { finding: unknown; call: ToolCall }> = {
    schema_mapper: () => schemaMapper(candidate),
    code_dictionary_validator: () => codeDictionaryValidator(candidate),
    tokenized_identity_matcher: () => tokenizedIdentityMatcher(candidate),
    access_policy_evaluator: () => accessPolicyEvaluator(candidate),
    anomaly_profiler: () => anomalyProfiler(candidate, release.release_date),
  };
  const allValidators = Object.keys(runners);
  const planFirst = plan.ordered_tools.filter((t) => t in runners);
  const order = [...new Set([...planFirst, ...allValidators])];

  const toolCalls: ToolCall[] = [];
  const findings: Record<string, any> = {};
  for (const name of order) {
    const { finding, call } = runners[name]();
    findings[name] = finding;
    toolCalls.push(call);
  }
  replay.push({
    phase: "tools",
    title: "tools 工具调用",
    detail: toolCalls
      .map((c) => `${c.tool} → ${c.ok ? "ok" : c.finding ?? "issue"}`)
      .join("；"),
    at: tNow(),
    ok: true,
  });

  // ---- Decide final state by safety precedence ----
  const schema = findings.schema_mapper;
  const anomaly = findings.anomaly_profiler;
  const dict = findings.code_dictionary_validator;
  const identity = findings.tokenized_identity_matcher;
  const policy = findings.access_policy_evaluator;

  let state: ReleaseState = "可发布";
  let issueType = "";
  let severity = "low";
  let sourceRule = "";
  let confidence = 0.99;
  let detectedFields: string[] = [];
  let writer: "correction" | "quarantine" | "approval" | null = null;
  let issueText = "";
  let recommendation = "";

  if (!schema.ok) {
    state = "隔离";
    issueType = "schema_field_missing";
    severity = "high";
    sourceRule = "R-schema";
    detectedFields = schema.missing;
    writer = "quarantine";
    issueText = `字段缺失：${schema.missing.join("、")}`;
    recommendation = "补齐缺失字段后重新生成数据并重新提交。";
  } else if (anomaly.anomaly) {
    state = "隔离";
    issueType = "date_anomaly";
    severity = "high";
    sourceRule = "R1 服务日期不得晚于发布日";
    detectedFields = ["service_date"];
    writer = "quarantine";
    issueText = anomaly.detail;
    recommendation = "修正服务日期或重新生成数据后重新提交，或联系数据提供方确认日期正确性。";
  } else if (!dict.valid && !dict.correctable) {
    state = "隔离";
    issueType = "code_dictionary_miss";
    severity = "high";
    sourceRule = "R2 病种编码必须命中医保目录字典";
    detectedFields = ["catalog_code"];
    confidence = 0.9;
    writer = "quarantine";
    issueText = `病种编码 ${candidate.catalog_code} 未命中医保目录字典且无安全纠错别名。`;
    recommendation = "由目录维护员确认正确编码后重新提交，或隔离该行。";
  } else if (!identity.matched) {
    state = "需审批";
    issueType = identity.ambiguous ? "identity_ambiguous" : "identity_unmatched";
    severity = "high";
    sourceRule = "R3 人员标识必须唯一命中身份注册表";
    detectedFields = ["person_token"];
    confidence = 0.55;
    writer = "approval";
    issueText = identity.ambiguous
      ? `身份 token 模糊匹配，存在 ${identity.candidates} 个候选，Agent 不自动放行。`
      : `身份 token 未命中注册表，无法确认身份。`;
    recommendation = "由数据安全员人工确认身份后再决定放行、纠错或隔离。";
  } else if (!policy.allowed) {
    state = "需审批";
    issueType = "access_policy_denied";
    severity = "high";
    sourceRule = "R4 访问角色与用途必须满足访问策略";
    detectedFields = ["requester_role", "purpose"];
    confidence = 0.6;
    writer = "approval";
    issueText = `访问策略拒绝：${policy.reason}。`;
    recommendation = "由业务审批人按访问策略审批后再决定是否放行。";
  } else if (!dict.valid && dict.correctable) {
    state = "纠错候选";
    issueType = "code_correctable";
    severity = "medium";
    sourceRule = "R2 病种编码必须命中医保目录字典";
    detectedFields = ["catalog_code"];
    confidence = 0.93;
    writer = "correction";
    issueText = `病种编码 ${candidate.catalog_code} 未命中字典，存在高置信纠错：${candidate.catalog_code} → ${dict.suggestion}（${dict.name}）。`;
    recommendation = "审核纠错提案，确认后纠正编码即可通行。";
  } else {
    state = "可发布";
    issueText = "未发现阻断性问题，当前行符合发布规则与访问策略。";
    recommendation = "可继续发布或导出审计包。";
  }

  // ---- Mutate state (durable writes) ----
  const createdIso = new Date().toISOString();
  let issueId: string | null = null;
  if (writer) {
    issueId = `ISS-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO row_issue (id, run_id, release_id, row_id, row_index, type, severity, detected_fields, source_rule, confidence, status, created_at)
       VALUES (:id, :run_id, :release_id, :row_id, :row_index, :type, :severity, :detected_fields, :source_rule, :confidence, :status, :created_at)`,
    ).run({
      id: issueId,
      run_id: runId,
      release_id: release.id,
      row_id: baseRow.id,
      row_index: baseRow.row_index,
      type: issueType,
      severity,
      detected_fields: JSON.stringify(detectedFields),
      source_rule: sourceRule,
      confidence,
      status: "open",
      created_at: createdIso,
    });
  }

  if (writer === "correction" && issueId) {
    db.prepare(
      `INSERT INTO correction_proposal (id, run_id, release_id, row_id, issue_id, field, before_value, after_value, source_dictionary, rationale, confidence, status, created_at)
       VALUES (:id, :run_id, :release_id, :row_id, :issue_id, :field, :before_value, :after_value, :source_dictionary, :rationale, :confidence, :status, :created_at)`,
    ).run({
      id: `COR-${randomUUID().slice(0, 8)}`,
      run_id: runId,
      release_id: release.id,
      row_id: baseRow.id,
      issue_id: issueId,
      field: "catalog_code",
      before_value: candidate.catalog_code,
      after_value: dict.suggestion ?? "",
      source_dictionary: manifest?.code_dictionary_version ?? "catalog-dict",
      rationale: `字典高置信别名映射：${candidate.catalog_code} → ${dict.suggestion}`,
      confidence,
      status: "pending",
      created_at: createdIso,
    });
    toolCalls.push({
      tool: "correction_writer",
      label: "纠错提案写入",
      input: `catalog_code ${candidate.catalog_code} → ${dict.suggestion}`,
      output: "correction_proposal(status=pending) 已写入 → ok",
      ok: true,
    });
  }

  if (writer === "quarantine" && issueId) {
    db.prepare(
      `INSERT INTO quarantine_item (id, run_id, release_id, row_id, issue_id, reason, impact, review_status, created_at)
       VALUES (:id, :run_id, :release_id, :row_id, :issue_id, :reason, :impact, :review_status, :created_at)`,
    ).run({
      id: `QAR-${randomUUID().slice(0, 8)}`,
      run_id: runId,
      release_id: release.id,
      row_id: baseRow.id,
      issue_id: issueId,
      reason: issueText,
      impact: "该行若放行将污染下游分析/共享/建模取数。",
      review_status: "isolated",
      created_at: createdIso,
    });
    toolCalls.push({
      tool: "quarantine_writer",
      label: "隔离项写入",
      input: `row #${baseRow.row_index + 1}`,
      output: "quarantine_item 已写入，release 置为隔离 → ok",
      ok: true,
    });
  }

  if (writer === "approval" && issueId) {
    db.prepare(
      `INSERT INTO release_approval (id, run_id, release_id, row_id, issue_id, status, reason, policy_snapshot, approver, human_notes, decided_at, created_at)
       VALUES (:id, :run_id, :release_id, :row_id, :issue_id, :status, :reason, :policy_snapshot, NULL, NULL, NULL, :created_at)`,
    ).run({
      id: `APR-${randomUUID().slice(0, 8)}`,
      run_id: runId,
      release_id: release.id,
      row_id: baseRow.id,
      issue_id: issueId,
      status: "pending",
      reason: issueText,
      policy_snapshot: accessSnapshot?.rules_json ?? "{}",
      created_at: createdIso,
    });
    toolCalls.push({
      tool: "approval_router",
      label: "审批路由",
      input: issueType,
      output: "release_approval(status=pending) 已写入，release 置为需审批 → ok",
      ok: true,
    });
  }

  replay.push({
    phase: "mutate",
    title: "mutate 状态变更",
    detail: `写入 row_issue${writer ? ` + ${writer}` : ""}；release_state ${beforeState} → ${state}`,
    at: tNow(),
    ok: true,
  });

  // ---- replay_builder + verify ----
  toolCalls.push({
    tool: "replay_builder",
    label: "回放组装",
    input: `run=${runId}`,
    output: "replay_timeline 已组装 → ok",
    ok: true,
  });

  updateReleaseState(release.id, state, runId);
  const verified = getRelease(release.id);
  replay.push({
    phase: "verify",
    title: "verify 验证",
    detail: `重新读取发布状态：${verified?.state}；证据已持久化（agent_run + replay_timeline）。`,
    at: tNow(),
    ok: verified?.state === state,
  });

  const finishedIso = new Date().toISOString();
  const durationMs = Date.now() - started.getTime();
  const outputHash = createHash("sha256")
    .update(
      JSON.stringify({
        mutation: input.mutationType,
        candidate,
        focus: plan.issue_focus,
        tools: toolCalls.map((t) => t.tool),
        issueType,
        state,
      }),
    )
    .digest("hex")
    .slice(0, 16);

  const providerMeta = { source: "live-provider", ...planResult.meta };

  insertRun(db, {
    runId,
    releaseId: release.id,
    mutationType: input.mutationType,
    inputSummary: summary,
    candidate: { row_index: baseRow.row_index, ...candidate },
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

function insertRun(
  db: ReturnType<typeof getDb>,
  r: {
    runId: string;
    releaseId: string;
    mutationType: MutationType;
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
    mutation_type: r.mutationType,
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
