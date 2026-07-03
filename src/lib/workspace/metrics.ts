import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "../db";

// ===== V2.3 治理效能指标 =====
// 全部从本地库实时计算，不缓存、不估拍：决策日志（approval_decision_log）、
// 漂移队列（policy_drift_log）、规则候选（rule_candidate）、政策事实（policy_fact）、
// agent 运行记录（agent_run）。"节省人时"按 15 分钟/条人工核实估算，口径随值一起返回。

export interface GovernanceMetrics {
  // 决策分流
  totalDecisions: number;
  autoApproved: number;
  needsHuman: number;
  humanApproved: number;
  humanRejected: number;
  autoRate: number; // auto_approved / (auto_approved + needs_human)，系统级自动分流率
  // 学习规则
  activeRules: number;
  pendingRules: number;
  suspendedRules: number;
  ruleHits: number;
  // 漂移闭环
  driftsDetected: number;
  driftsResolved: number;
  driftsOpen: number;
  // 政策事实
  factCount: number;
  policyFingerprint: string | null; // 全量政策事实的组合指纹，任一条变更即变化
  // 运行
  workspaceRuns: number;
  avgRunMs: number | null;
  // 效能估算（口径公开）
  estimatedMinutesSaved: number;
  savingAssumption: string;
}

function count(db: ReturnType<typeof getDb>, sql: string, params?: Record<string, unknown>): number {
  const row = (params ? db.prepare(sql).get(params) : db.prepare(sql).get()) as { n?: number } | null;
  return Number(row?.n ?? 0);
}

export function getGovernanceMetrics(): GovernanceMetrics {
  const db = getDb();

  const decisionCount = (decision: string) =>
    count(db, "SELECT COUNT(*) AS n FROM approval_decision_log WHERE decision = :d", { d: decision });

  const autoApproved = decisionCount("auto_approved");
  const needsHuman = decisionCount("needs_human");
  const humanApproved = decisionCount("human_approved");
  const humanRejected = decisionCount("human_rejected");
  const totalDecisions = count(db, "SELECT COUNT(*) AS n FROM approval_decision_log");

  const routed = autoApproved + needsHuman;
  const autoRate = routed > 0 ? autoApproved / routed : 0;

  const ruleCount = (status: string) =>
    count(db, "SELECT COUNT(*) AS n FROM rule_candidate WHERE status = :s", { s: status });
  const ruleHits = count(db, "SELECT COALESCE(SUM(hit_count), 0) AS n FROM rule_candidate");

  const driftsDetected = count(db, "SELECT COUNT(*) AS n FROM policy_drift_log");
  const driftsResolved = count(
    db,
    "SELECT COUNT(*) AS n FROM policy_drift_log WHERE status IN ('resolved','dismissed')",
  );

  // 政策事实组合指纹：对 (item_code, source_hash) 排序后哈希；任一条政策事实变更即变化。
  const factRows = db
    .prepare("SELECT item_code, COALESCE(source_hash, '') AS source_hash FROM policy_fact ORDER BY item_code")
    .all() as { item_code: string; source_hash: string }[];
  const policyFingerprint =
    factRows.length > 0
      ? createHash("sha256")
          .update(factRows.map((r) => `${r.item_code}:${r.source_hash}`).join("|"))
          .digest("hex")
          .slice(0, 12)
      : null;

  const workspaceRuns = count(
    db,
    "SELECT COUNT(*) AS n FROM agent_run WHERE mutation_type = 'workspace_conversation'",
  );
  const avgRow = db
    .prepare(
      "SELECT AVG(duration_ms) AS avg_ms FROM agent_run WHERE mutation_type = 'workspace_conversation' AND duration_ms IS NOT NULL",
    )
    .get() as { avg_ms: number | null } | null;
  const avgRunMs = avgRow?.avg_ms != null ? Math.round(avgRow.avg_ms) : null;

  return {
    totalDecisions,
    autoApproved,
    needsHuman,
    humanApproved,
    humanRejected,
    autoRate: Number(autoRate.toFixed(4)),
    activeRules: ruleCount("active"),
    pendingRules: ruleCount("pending_review"),
    suspendedRules: ruleCount("suspended"),
    ruleHits,
    driftsDetected,
    driftsResolved,
    driftsOpen: driftsDetected - driftsResolved,
    factCount: factRows.length,
    policyFingerprint,
    workspaceRuns,
    avgRunMs,
    estimatedMinutesSaved: autoApproved * 15,
    savingAssumption: "按一线人工核实 15 分钟/条估算，仅统计规则自动处置项",
  };
}
