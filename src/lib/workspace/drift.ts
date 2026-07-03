import "server-only";
import { getDb } from "../db";
import { workspaceId, workspaceNow } from "./repo";

// ===== V2.2 政策漂移检测 =====
// 漂移 = 政策事实（policy_fact baseline）变化后，已观察的价格数据不再合规。
// 真相源：baseline 一律从 policy_fact 现读（不是代码里的 PRICE_CATALOG 快照）——
// 这样 policy-update / artifact confirm 更新 policy_fact 后，下次 run 才能真实检出漂移。
// observed 来自 workspaceTools 已算的 basisPacks（observed_min/max）。
// 每条 high/critical 漂移会创建"政策漂移复核"workflow_task，进入人审处置流程。

export interface DriftCheckInput {
  threadId: string;
  runId: string;
  groups: Array<{
    group_key: string;
    // 原始编码与目录命中情况（code_invalid 检测用）
    raw_item_code: string | null;
    catalog_matched: boolean;
    observed_min: number | null;
    observed_max: number | null;
  }>;
  // 阈值可配置：不同地区/品类可在调用侧覆盖（答辩口径），默认 3% / 15%。
  thresholds?: {
    collectiveTolerancePct?: number;
    referenceSpikePct?: number;
  };
}

export interface DriftCheckResult {
  detected: number;
  critical: number;
  high: number;
  medium: number;
  tasksCreated: number;
}

interface DriftRecord {
  id: string;
  item_code: string;
  rule_key: string;
  baseline: Record<string, unknown>;
  observed: Record<string, unknown>;
  drift_type: string;
  drift_score: number;
  severity: "critical" | "high" | "medium";
}

export function detectPolicyDrift(input: DriftCheckInput): DriftCheckResult {
  const db = getDb();
  const now = workspaceNow();
  const collectiveTol = input.thresholds?.collectiveTolerancePct ?? 0.03;
  const spikeTol = input.thresholds?.referenceSpikePct ?? 0.15;

  const drifts: DriftRecord[] = [];

  for (const g of input.groups) {
    // 0. 编码失效/重映射：编码非空、目录未命中、policy_fact 也查无此码 → code_invalid（人审）
    if (!g.catalog_matched) {
      const raw = (g.raw_item_code ?? "").trim();
      if (raw && !getBaselineForItem(raw).exists) {
        drifts.push({
          id: workspaceId("DRIFT"),
          item_code: raw,
          rule_key: "code_invalid",
          baseline: { policy_fact: null },
          observed: { item_code: raw, observed_max: g.observed_max },
          drift_type: "code_invalid",
          drift_score: 1,
          severity: "high",
        });
      }
      continue;
    }

    // baseline 从 policy_fact 现读（真相源）
    const baseline = getBaselineForItem(g.group_key);
    if (!baseline.exists) {
      // 目录命中但 policy_fact 缺失（编码被政策版本移除/重映射）→ code_invalid
      drifts.push({
        id: workspaceId("DRIFT"),
        item_code: g.group_key,
        rule_key: "code_invalid",
        baseline: { policy_fact: null },
        observed: { item_code: g.group_key, observed_max: g.observed_max },
        drift_type: "code_invalid",
        drift_score: 1,
        severity: "high",
      });
      continue;
    }

    // 1. 超最高有效价 → critical
    if (baseline.ceiling_price != null && g.observed_max != null && g.observed_max > baseline.ceiling_price) {
      drifts.push({
        id: workspaceId("DRIFT"),
        item_code: g.group_key,
        rule_key: "over_ceiling",
        baseline: { ceiling_price: baseline.ceiling_price, source_hash: baseline.source_hash },
        observed: { observed_max: g.observed_max },
        drift_type: "ceiling_price_exceeded",
        drift_score: g.observed_max - baseline.ceiling_price,
        severity: "critical",
      });
      continue;
    }
    // 2. 集采价超中选价容忍阈值 → high
    if (baseline.collective_price != null && baseline.collective_price > 0 && g.observed_max != null) {
      const overPct = (g.observed_max - baseline.collective_price) / baseline.collective_price;
      if (overPct > collectiveTol) {
        drifts.push({
          id: workspaceId("DRIFT"),
          item_code: g.group_key,
          rule_key: "collective_over_tolerance",
          baseline: { collective_price: baseline.collective_price, tolerance_pct: collectiveTol, source_hash: baseline.source_hash },
          observed: { observed_max: g.observed_max, over_pct: Number(overPct.toFixed(4)) },
          drift_type: "collective_price_changed",
          drift_score: overPct,
          severity: "high",
        });
        continue;
      }
    }
    // 3. 参考价涨幅超阈值 → medium
    if (baseline.reference_price != null && baseline.reference_price > 0 && g.observed_max != null) {
      const overPct = (g.observed_max - baseline.reference_price) / baseline.reference_price;
      if (overPct > spikeTol) {
        drifts.push({
          id: workspaceId("DRIFT"),
          item_code: g.group_key,
          rule_key: "reference_price_delta",
          baseline: { reference_price: baseline.reference_price, spike_pct: spikeTol, source_hash: baseline.source_hash },
          observed: { observed_max: g.observed_max, over_pct: Number(overPct.toFixed(4)) },
          drift_type: "reference_price_changed",
          drift_score: overPct,
          severity: "medium",
        });
      }
    }
  }

  // 去重后写库：同 (item_code, rule_key, baseline_json) 且未关闭的漂移不重复写。
  // 政策变了（baseline_json 变）会写新记录——这正是"政策变更引发新漂移"的证据。
  const written: DriftRecord[] = [];
  for (const d of drifts) {
    const baselineJson = JSON.stringify(d.baseline);
    const dup = db
      .prepare(
        `SELECT id FROM policy_drift_log
         WHERE item_code = :item_code AND rule_key = :rule_key AND baseline_json = :baseline_json
           AND status IN ('detected') LIMIT 1`,
      )
      .get({ item_code: d.item_code, rule_key: d.rule_key, baseline_json: baselineJson });
    if (dup) continue;
    db.prepare(
      `INSERT INTO policy_drift_log
       (id, detected_at, item_code, rule_key, baseline_json, observed_json, drift_type, drift_score, severity, status, thread_id, run_id, created_at)
       VALUES (:id, :detected_at, :item_code, :rule_key, :baseline_json, :observed_json, :drift_type, :drift_score, :severity, 'detected', :thread_id, :run_id, :created_at)`,
    ).run({
      id: d.id,
      detected_at: now,
      item_code: d.item_code,
      rule_key: d.rule_key,
      baseline_json: baselineJson,
      observed_json: JSON.stringify(d.observed),
      drift_type: d.drift_type,
      drift_score: d.drift_score,
      severity: d.severity,
      thread_id: input.threadId,
      run_id: input.runId,
      created_at: now,
    });
    written.push(d);
  }

  // high/critical 漂移不只写 log：创建"政策漂移复核"人审任务，让漂移真正进入处置流程。
  const tasksCreated = createDriftTasks(db, input.threadId, input.runId, written, now);

  return {
    detected: written.length,
    critical: written.filter((d) => d.severity === "critical").length,
    high: written.filter((d) => d.severity === "high").length,
    medium: written.filter((d) => d.severity === "medium").length,
    tasksCreated,
  };
}

function createDriftTasks(
  db: ReturnType<typeof getDb>,
  threadId: string,
  runId: string,
  drifts: DriftRecord[],
  now: string,
): number {
  const ins = db.prepare(
    `INSERT INTO workflow_task
     (id, thread_id, run_id, disposition_id, drift_id, task_type, owner_role, status, priority, due_at, title, detail, created_at, updated_at)
     VALUES (:id, :thread_id, :run_id, NULL, :drift_id, '政策漂移复核', '价格治理岗', '待复核', :priority, :due_at, :title, :detail, :created_at, :updated_at)`,
  );
  let created = 0;
  for (const d of drifts) {
    if (d.severity !== "critical" && d.severity !== "high") continue;
    const baselineText = Object.entries(d.baseline)
      .filter(([k]) => k !== "source_hash")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    const observedText = Object.entries(d.observed)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ");
    ins.run({
      id: workspaceId("WFT"),
      thread_id: threadId,
      run_id: runId,
      drift_id: d.id,
      priority: d.severity === "critical" ? "high" : "high",
      due_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      title: `${d.item_code} · ${d.rule_key}`,
      detail: `政策漂移（${d.severity}）：baseline ${baselineText}；observed ${observedText}。敏感结论，需人工复核后处置。`,
      created_at: now,
      updated_at: now,
    });
    created += 1;
  }
  return created;
}

// 获取 baseline 对照源：从 policy_fact 表读（漂移检测的真相源）。
// 如果 policy_fact 没有该 item（编码更新后失效/重映射），exists=false → 触发 code_invalid 漂移。
export function getBaselineForItem(itemCode: string): {
  reference_price: number | null;
  ceiling_price: number | null;
  collective_price: number | null;
  landed_regions: string[];
  source_hash: string | null;
  exists: boolean;
} {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT reference_price, ceiling_price, collective_price, landed_regions_json, source_hash FROM policy_fact WHERE item_code = :code ORDER BY created_at DESC LIMIT 1",
    )
    .get({ code: itemCode }) as
    | { reference_price: number | null; ceiling_price: number | null; collective_price: number | null; landed_regions_json: string; source_hash: string | null }
    | null;
  if (!row) {
    return { reference_price: null, ceiling_price: null, collective_price: null, landed_regions: [], source_hash: null, exists: false };
  }
  return {
    reference_price: row.reference_price,
    ceiling_price: row.ceiling_price,
    collective_price: row.collective_price,
    landed_regions: safeParse(row.landed_regions_json, []),
    source_hash: row.source_hash,
    exists: true,
  };
}

// 模拟一次政策更新：把某 item 的 baseline（如集采中选价）下调，触发漂移。
// 用于演示"政策变了→存量数据漂移→重跑"。真实链路走 policy_artifact 人审确认（confirm API）。
export function simulatePolicyUpdate(itemCode: string, patch: {
  reference_price?: number;
  ceiling_price?: number;
  collective_price?: number;
}): { updated: boolean; drift_expected: boolean } {
  const db = getDb();
  // policy_fact 用 source_hash 标记版本；更新价格时同步刷新 source_hash。
  const result = db
    .prepare(
      `UPDATE policy_fact
       SET reference_price = COALESCE(:ref, reference_price),
           ceiling_price = COALESCE(:ceil, ceiling_price),
           collective_price = COALESCE(:coll, collective_price),
           source_hash = :new_hash
       WHERE item_code = :code`,
    )
    .run({
      ref: patch.reference_price ?? null,
      ceil: patch.ceiling_price ?? null,
      coll: patch.collective_price ?? null,
      new_hash: `policy-update-${Date.now()}`,
      code: itemCode,
    });
  return { updated: (result.changes ?? 0) > 0, drift_expected: (result.changes ?? 0) > 0 };
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
