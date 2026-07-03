import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "../db";
import { workspaceDb, workspaceId, workspaceNow } from "./repo";
import { mustHumanReview, inferGuardrailInput } from "./guardrails";

type DbLike = ReturnType<typeof getDb>;

// ===== V2 自学习规则引擎 =====
// 泛化自 runWorkspaceAgent.ts 的 applyFollowupPolicyIfNeeded（"指令→UPDATE workflow_task"雏形）。
// 核心闭环：处置反馈 → 挖掘候选规则 → 人审激活 → 下批自动复用 → 漂移时降级回人审。
// 高置信 + 护栏通过 → 自动处置（auto_approved）；低置信/敏感 → 转人审（needs_user）。

export interface RuleTrigger {
  issue_type?: string;
  severity?: string;
  conditions?: Record<string, unknown>;
}

export interface RuleAction {
  task_type: string;
  owner_role: string;
  priority: string;
  status?: string;
}

export interface RuleCandidate {
  id: string;
  trigger_json: string;
  proposed_action_json: string;
  confidence: number;
  support_count: number;
  status: string;
  source_feedback_ids_json: string | null;
  provenance_run_id: string | null;
  hit_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApplyLearnedRulesResult {
  autoApproved: number;
  escalatedToHuman: number;
  rulesApplied: number;
}

// 护栏逻辑见 guardrails.ts；这里复用 mustHumanReview + inferGuardrailInput。

// 判断一条 disposition 是否匹配某条规则候选的 trigger。
function matchesTrigger(trigger: RuleTrigger, disp: {
  issue_type: string;
  severity: string;
}): boolean {
  if (trigger.issue_type && trigger.issue_type !== disp.issue_type) return false;
  if (trigger.severity) {
    const sevRank: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
    const want = sevRank[trigger.severity.toLowerCase()] ?? -1;
    const have = sevRank[disp.severity.toLowerCase()] ?? -1;
    if (want >= 0 && have > want) return false; // 规则只覆盖到自身严重度及以下
  }
  return true;
}

// 在一次 agent run 之后，对本次生成的 disposition_item / workflow_task 应用已激活的学习规则。
// 高置信 + 护栏通过 → 自动处置（status=auto_approved）；否则 → 转人审（status=needs_user）。
export function applyLearnedRules(threadId: string, runId: string): ApplyLearnedRulesResult {
  const db = workspaceDb();
  const rules = db
    .prepare("SELECT * FROM rule_candidate WHERE status = 'active'")
    .all() as unknown as RuleCandidate[];

  // 注意：没有激活规则时也要跑护栏——敏感项转人审并写 needs_human 决策日志。
  // 这份日志既是审计留痕，也是后续规则挖掘的数据源，不能因为规则为空就跳过。

  const dispositions = db
    .prepare("SELECT id, issue_type, severity FROM disposition_item WHERE thread_id = :tid AND run_id = :rid")
    .all({ tid: threadId, rid: runId }) as { id: string; issue_type: string; severity: string }[];

  let autoApproved = 0;
  let escalated = 0;
  let rulesApplied = 0;
  const now = workspaceNow();
  const hitRuleIds = new Set<string>();

  for (const disp of dispositions) {
    // 护栏先行：敏感项一律人审
    const guardrail = mustHumanReview(inferGuardrailInput(disp));

    if (guardrail.mustHuman) {
      // 转人审，写决策日志
      logDecision(db, {
        thread_id: threadId,
        run_id: runId,
        target_type: "disposition",
        target_id: disp.id,
        decision: "needs_human",
        reason_codes: guardrail.reasons,
        context: { issue_type: disp.issue_type, severity: disp.severity },
        actor_type: "system",
        actor_id: "guardrails",
      });
      escalated += 1;
      continue;
    }

    // 找匹配的 active 规则
    const matched = rules.find((r) => {
      try {
        const trigger = JSON.parse(r.trigger_json) as RuleTrigger;
        return matchesTrigger(trigger, disp);
      } catch {
        return false;
      }
    });

    if (matched) {
      // 自动处置：用规则的 proposed_action 更新 workflow_task
      try {
        const action = JSON.parse(matched.proposed_action_json) as RuleAction;
        db.prepare(
          `UPDATE workflow_task
           SET task_type = :task_type, owner_role = :owner_role, priority = :priority,
               status = :status, detail = detail || '；按学习规则自动处置。', updated_at = :now
           WHERE thread_id = :tid AND run_id = :rid AND disposition_id = :did`,
        ).run({
          task_type: action.task_type,
          owner_role: action.owner_role,
          priority: action.priority,
          status: action.status ?? "自动处置",
          tid: threadId,
          rid: runId,
          did: disp.id,
          now,
        });
        hitRuleIds.add(matched.id);
        logDecision(db, {
          thread_id: threadId,
          run_id: runId,
          target_type: "disposition",
          target_id: disp.id,
          decision: "auto_approved",
          reason_codes: ["matched_active_rule"],
          context: {
            issue_type: disp.issue_type,
            severity: disp.severity,
            rule_candidate_id: matched.id,
            confidence: matched.confidence,
          },
          actor_type: "system",
          actor_id: "learned_rule_engine",
          rule_candidate_id: matched.id,
        });
        autoApproved += 1;
      } catch {
        // 解析失败的安全兜底：转人审
        escalated += 1;
      }
    } else {
      // 无匹配规则：转人审（等待沉淀）
      escalated += 1;
    }
  }

  // 更新规则命中计数
  for (const rid of hitRuleIds) {
    db.prepare("UPDATE rule_candidate SET hit_count = hit_count + 1, updated_at = :now WHERE id = :id").run({
      id: rid,
      now,
    });
    rulesApplied += 1;
  }

  // 写一条 learn 阶段的 run_event
  if (autoApproved > 0 || escalated > 0) {
    db.prepare(
      `INSERT INTO run_event (id, thread_id, run_id, phase, title, detail, ok, event_json, created_at)
       VALUES (:id, :tid, :rid, 'learn', :title, :detail, 1, :event_json, :created_at)`,
    ).run({
      id: workspaceId("EVT"),
      tid: threadId,
      rid: runId,
      title: "学习规则引擎运行",
      detail: `自动处置 ${autoApproved} 条，转人审 ${escalated} 条，命中 ${hitRuleIds.size} 条激活规则。`,
      event_json: JSON.stringify({ autoApproved, escalatedToHuman: escalated, rulesApplied: hitRuleIds.size }),
      created_at: now,
    });
  }

  return { autoApproved, escalatedToHuman: escalated, rulesApplied: hitRuleIds.size };
}

// 不可变决策日志（自动+人审全留痕；规则挖掘的数据源）
export function logDecision(
  db: DbLike,
  input: {
    thread_id: string | null;
    run_id: string | null;
    target_type: string;
    target_id: string;
    decision: string;
    reason_codes: string[];
    context: Record<string, unknown>;
    actor_type: string;
    actor_id: string | null;
    rule_candidate_id?: string | null;
    notes?: string;
  },
): void {
  const ctxJson = JSON.stringify(input.context);
  db.prepare(
    `INSERT INTO approval_decision_log
     (id, thread_id, run_id, target_type, target_id, decision, reason_codes_json, context_json, context_hash, actor_type, actor_id, rule_candidate_id, notes, created_at)
     VALUES (:id, :thread_id, :run_id, :target_type, :target_id, :decision, :reason_codes_json, :context_json, :context_hash, :actor_type, :actor_id, :rule_candidate_id, :notes, :created_at)`,
  ).run({
    id: workspaceId("DEC"),
    thread_id: input.thread_id,
    run_id: input.run_id,
    target_type: input.target_type,
    target_id: input.target_id,
    decision: input.decision,
    reason_codes_json: JSON.stringify(input.reason_codes),
    context_json: ctxJson,
    context_hash: hashOutput(ctxJson),
    actor_type: input.actor_type,
    actor_id: input.actor_id,
    rule_candidate_id: input.rule_candidate_id ?? null,
    notes: input.notes ?? null,
    created_at: workspaceNow(),
  });
}

// ===== V2.2 规则挖掘：从人审反馈真正学 =====
// 数据源：approval_decision_log 里 decision='human_approved' 的人审记录（30 天窗口），
// context_json 携带 {issue_type, severity, final_action, owner_role, priority}（由任务决策 API 写入）。
// 聚合：(issue_type, severity, final_action) 三元组；support≥minSupport 且该 (issue_type,severity)
// 下人审一致（无驳回多数）才提候选。proposed_action 从人审实际处置多数票聚合，
// 候选带真实 source_decision_ids_json + provenance_run_id，可逐条审计。
// 仍是简化频繁模式聚合（不做 ML）；候选必须人审激活后才会被 applyLearnedRules 复用。
export function mineRuleCandidates(opts?: {
  minSupport?: number;
  minConfidence?: number;
}): { proposed: number; scannedDecisions: number } {
  const db = workspaceDb();
  const minSupport = opts?.minSupport ?? 3;
  const minConfidence = opts?.minConfidence ?? 0.9;

  const rows = db
    .prepare(
      `SELECT id, run_id, context_json, decision FROM approval_decision_log
       WHERE target_type IN ('disposition', 'workflow_task')
         AND decision IN ('human_approved', 'human_rejected')
         AND created_at > datetime('now', '-30 days')
       ORDER BY created_at ASC`,
    )
    .all() as { id: string; run_id: string | null; context_json: string; decision: string }[];

  interface Bucket {
    issue_type: string;
    severity: string;
    final_action: string;
    owner_roles: Map<string, number>;
    priorities: Map<string, number>;
    approvedIds: string[];
    runIds: string[];
  }
  const buckets = new Map<string, Bucket>();
  // 同 (issue_type, severity) 下的驳回数：人审有分歧的模式不提候选。
  const rejectedByPattern = new Map<string, number>();

  for (const r of rows) {
    let ctx: {
      issue_type?: string;
      severity?: string;
      final_action?: string;
      owner_role?: string;
      priority?: string;
    };
    try {
      ctx = JSON.parse(r.context_json) as typeof ctx;
    } catch {
      continue;
    }
    const issueType = ctx.issue_type ?? "";
    const severity = (ctx.severity ?? "").toLowerCase();
    if (!issueType || !severity) continue;
    const patternKey = `${issueType}|${severity}`;

    if (r.decision === "human_rejected") {
      rejectedByPattern.set(patternKey, (rejectedByPattern.get(patternKey) ?? 0) + 1);
      continue;
    }
    const finalAction = ctx.final_action ?? "";
    if (!finalAction) continue;
    const key = `${patternKey}|${finalAction}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        issue_type: issueType,
        severity,
        final_action: finalAction,
        owner_roles: new Map(),
        priorities: new Map(),
        approvedIds: [],
        runIds: [],
      };
      buckets.set(key, b);
    }
    b.approvedIds.push(r.id);
    if (r.run_id) b.runIds.push(r.run_id);
    if (ctx.owner_role) b.owner_roles.set(ctx.owner_role, (b.owner_roles.get(ctx.owner_role) ?? 0) + 1);
    if (ctx.priority) b.priorities.set(ctx.priority, (b.priorities.get(ctx.priority) ?? 0) + 1);
  }

  const now = workspaceNow();
  let proposed = 0;
  for (const [, b] of buckets) {
    const patternKey = `${b.issue_type}|${b.severity}`;
    const support = b.approvedIds.length;
    if (support < minSupport) continue;
    const rejected = rejectedByPattern.get(patternKey) ?? 0;
    const confidence = support / (support + rejected);
    if (confidence < minConfidence) continue;

    const trigger: RuleTrigger = { issue_type: b.issue_type, severity: b.severity };
    const action: RuleAction = {
      task_type: b.final_action,
      owner_role: majority(b.owner_roles) ?? "价格治理岗",
      priority: majority(b.priorities) ?? "medium",
      status: "自动处置",
    };
    const triggerJson = JSON.stringify(trigger);
    const actionJson = JSON.stringify(action);

    // 去重：同 trigger+action 的 pending/active 候选已存在则跳过
    const exists = db
      .prepare(
        `SELECT id FROM rule_candidate WHERE trigger_json = :t AND proposed_action_json = :a AND status IN ('pending_review','active') LIMIT 1`,
      )
      .get({ t: triggerJson, a: actionJson });
    if (exists) continue;

    db.prepare(
      `INSERT INTO rule_candidate
       (id, trigger_json, proposed_action_json, confidence, support_count, status, source_feedback_ids_json, source_decision_ids_json, provenance_run_id, hit_count, created_at, updated_at)
       VALUES (:id, :t, :a, :conf, :sup, 'pending_review', :feedback_ids, :decision_ids, :provenance_run_id, 0, :now, :now)`,
    ).run({
      id: workspaceId("RC"),
      t: triggerJson,
      a: actionJson,
      conf: Number(confidence.toFixed(4)),
      sup: support,
      feedback_ids: JSON.stringify(b.approvedIds),
      decision_ids: JSON.stringify(b.approvedIds),
      provenance_run_id: b.runIds.at(-1) ?? null,
      now,
    });
    proposed += 1;
  }
  return { proposed, scannedDecisions: rows.length };
}

function majority(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [k, v] of counts) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best;
}

// 规则激活前的影响面预览（dry-run）：如果激活这条候选，将命中多少历史 case、
// 其中多少条会被护栏挡回人审、多少条可自动处置。不改任何状态。
export function dryRunRule(id: string): {
  found: boolean;
  matched: number;
  guardrailBlocked: number;
  autoApplicable: number;
} {
  const db = workspaceDb();
  const candidate = db
    .prepare("SELECT trigger_json FROM rule_candidate WHERE id = :id LIMIT 1")
    .get({ id }) as { trigger_json: string } | null;
  if (!candidate) {
    return { found: false, matched: 0, guardrailBlocked: 0, autoApplicable: 0 };
  }
  let trigger: RuleTrigger;
  try {
    trigger = JSON.parse(candidate.trigger_json) as RuleTrigger;
  } catch {
    return { found: false, matched: 0, guardrailBlocked: 0, autoApplicable: 0 };
  }

  const dispositions = db
    .prepare("SELECT issue_type, severity FROM disposition_item")
    .all() as { issue_type: string; severity: string }[];

  let matched = 0;
  let blocked = 0;
  for (const disp of dispositions) {
    if (!matchesTrigger(trigger, disp)) continue;
    matched += 1;
    if (mustHumanReview(inferGuardrailInput(disp)).mustHuman) blocked += 1;
  }
  return { found: true, matched, guardrailBlocked: blocked, autoApplicable: matched - blocked };
}

// 人审激活一条规则候选：pending_review → active。之后下批 run 会自动复用。
export function ratifyRuleCandidate(id: string, reviewer: string, notes?: string): boolean {
  const db = workspaceDb();
  const result = db
    .prepare(
      `UPDATE rule_candidate SET status = 'active', reviewer = :reviewer, review_notes = :notes, decided_at = :now, updated_at = :now WHERE id = :id AND status = 'pending_review'`,
    )
    .run({ id, reviewer, notes: notes ?? null, now: workspaceNow() });
  return (result.changes ?? 0) > 0;
}

// 停用一条已激活规则（可回滚的自动化）：active → suspended。
// 停用立即生效——applyLearnedRules 只加载 status='active'，下批 run 同类项回到人审。
export function suspendRuleCandidate(id: string, reviewer: string, notes?: string): boolean {
  const db = workspaceDb();
  const result = db
    .prepare(
      `UPDATE rule_candidate SET status = 'suspended', reviewer = :reviewer, review_notes = :notes, decided_at = :now, updated_at = :now WHERE id = :id AND status = 'active'`,
    )
    .run({ id, reviewer, notes: notes ?? null, now: workspaceNow() });
  return (result.changes ?? 0) > 0;
}

// 恢复一条已停用规则：suspended → active（再次人工确认后才恢复自动处置）。
export function resumeRuleCandidate(id: string, reviewer: string, notes?: string): boolean {
  const db = workspaceDb();
  const result = db
    .prepare(
      `UPDATE rule_candidate SET status = 'active', reviewer = :reviewer, review_notes = :notes, decided_at = :now, updated_at = :now WHERE id = :id AND status = 'suspended'`,
    )
    .run({ id, reviewer, notes: notes ?? null, now: workspaceNow() });
  return (result.changes ?? 0) > 0;
}

export function rejectRuleCandidate(id: string, reviewer: string, notes?: string): boolean {
  const db = workspaceDb();
  const result = db
    .prepare(
      `UPDATE rule_candidate SET status = 'rejected', reviewer = :reviewer, review_notes = :notes, decided_at = :now, updated_at = :now WHERE id = :id AND status = 'pending_review'`,
    )
    .run({ id, reviewer, notes: notes ?? null, now: workspaceNow() });
  return (result.changes ?? 0) > 0;
}

export function listRuleCandidates(status?: string): RuleCandidate[] {
  const db = workspaceDb();
  if (status) {
    return db.prepare("SELECT * FROM rule_candidate WHERE status = :s ORDER BY created_at DESC").all({ s: status }) as unknown as RuleCandidate[];
  }
  return db.prepare("SELECT * FROM rule_candidate ORDER BY created_at DESC").all() as unknown as RuleCandidate[];
}

export function listPolicyFacts(): Array<Record<string, unknown>> {
  const db = getDb();
  return db.prepare("SELECT * FROM policy_fact ORDER BY item_code").all();
}

export function listPolicySources(): Array<Record<string, unknown>> {
  const db = getDb();
  return db.prepare("SELECT * FROM policy_source ORDER BY created_at").all();
}

export function listPolicyDrifts(status?: string): Array<Record<string, unknown>> {
  const db = getDb();
  if (status) {
    return db.prepare("SELECT * FROM policy_drift_log WHERE status = :s ORDER BY detected_at DESC").all({ s: status });
  }
  return db.prepare("SELECT * FROM policy_drift_log ORDER BY detected_at DESC").all();
}

// 审计日志读取（右栏审计条 + claim/evidence 用）
export function listDecisionLog(limit = 12): Array<Record<string, unknown>> {
  const db = getDb();
  return db
    .prepare("SELECT * FROM approval_decision_log ORDER BY created_at DESC LIMIT " + Math.max(1, Math.min(100, Math.floor(limit))))
    .all();
}

function hashOutput(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
