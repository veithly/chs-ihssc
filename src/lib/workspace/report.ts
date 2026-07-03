import "server-only";
import { getDb } from "../db";
import type { WorkspaceSnapshot } from "../types";
import { getWorkspaceSnapshot } from "./repo";
import { getGovernanceMetrics, type GovernanceMetrics } from "./metrics";

// ===== V2.3 处置结果单 =====
// 把一次会话的治理产物汇编成可打印归档的报告：批次概览、效能摘要、漂移明细、
// 任务处置明细、规则引用、决策日志、政策指纹。全部现读本地库，与工作台同源可对账。

export interface ThreadDriftRow {
  id: string;
  item_code: string;
  rule_key: string;
  severity: string;
  status: string;
  baseline_json: string;
  observed_json: string;
  detected_at: string;
}

export interface ThreadDecisionRow {
  id: string;
  decision: string;
  target_type: string;
  target_id: string;
  actor_type: string;
  actor_id: string | null;
  reason_codes_json: string;
  context_json: string;
  created_at: string;
}

export interface ActiveRuleRow {
  id: string;
  status: string;
  trigger_json: string;
  proposed_action_json: string;
  confidence: number;
  support_count: number;
  hit_count: number;
}

export interface ThreadReport {
  found: boolean;
  generatedAt: string;
  snapshot: WorkspaceSnapshot;
  metrics: GovernanceMetrics;
  drifts: ThreadDriftRow[];
  decisions: ThreadDecisionRow[];
  rules: ActiveRuleRow[];
  latestOutputHash: string | null;
  runCount: number;
}

export function getThreadReport(threadId: string): ThreadReport {
  const db = getDb();
  const snapshot = getWorkspaceSnapshot(threadId);
  const found = Boolean(snapshot.thread && snapshot.thread.id === threadId);

  const drifts = found
    ? (db
        .prepare(
          "SELECT id, item_code, rule_key, severity, status, baseline_json, observed_json, detected_at FROM policy_drift_log WHERE thread_id = :tid ORDER BY detected_at DESC",
        )
        .all({ tid: threadId }) as unknown as ThreadDriftRow[])
    : [];

  // 决策日志：本会话相关（含规则激活/停用这类全局决策，target_type='rule'）
  const decisions = found
    ? (db
        .prepare(
          `SELECT id, decision, target_type, target_id, actor_type, actor_id, reason_codes_json, context_json, created_at
           FROM approval_decision_log
           WHERE thread_id = :tid OR target_type = 'rule'
           ORDER BY created_at ASC`,
        )
        .all({ tid: threadId }) as unknown as ThreadDecisionRow[])
    : [];

  const rules = db
    .prepare(
      "SELECT id, status, trigger_json, proposed_action_json, confidence, support_count, hit_count FROM rule_candidate WHERE status IN ('active','suspended') ORDER BY updated_at DESC",
    )
    .all() as unknown as ActiveRuleRow[];

  const runRow = found
    ? (db
        .prepare(
          "SELECT COUNT(*) AS n FROM agent_run WHERE release_id = :tid AND mutation_type = 'workspace_conversation'",
        )
        .get({ tid: threadId }) as { n: number })
    : { n: 0 };
  const hashRow = found
    ? (db
        .prepare(
          "SELECT output_hash FROM agent_run WHERE release_id = :tid AND mutation_type = 'workspace_conversation' ORDER BY finished_at DESC LIMIT 1",
        )
        .get({ tid: threadId }) as { output_hash: string | null } | null)
    : null;

  return {
    found,
    generatedAt: new Date().toISOString(),
    snapshot,
    metrics: getGovernanceMetrics(),
    drifts,
    decisions,
    rules,
    latestOutputHash: hashRow?.output_hash ?? null,
    runCount: runRow.n,
  };
}
