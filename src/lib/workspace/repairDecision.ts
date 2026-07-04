import "server-only";
import { getDb } from "../db";
import { workspaceNow } from "./repo";
import { logDecision } from "./rules";

// ===== 修复提案卡的人审决策 =====
// agent 生成的 repair_patch（proposed / needs_user）在会话流提案卡里直接采纳或忽略。
// 采纳 = 真正回写 uploaded_dataset.rows_json（可先编辑修复值再采纳），下次 run 用修复后的数据；
// 决策写入不可变 approval_decision_log，与任务人审同源，可被规则挖掘复用。

const PENDING_STATUSES = new Set(["proposed", "needs_user"]);

// 字段 → 演示/官方表头兜底列名（field_mapping 查不到 source_column 时新增列用）
const FIELD_COLUMN_FALLBACK: Record<string, string> = {
  item_code: "医保项目编码",
  item_name: "药品/耗材名称",
  price_date: "价格日期",
  procurement_channel: "采购渠道",
  region: "地区",
  unit_price: "机构执行价",
  institution_name: "机构名称",
  package_unit: "包装单位",
};

export interface RepairDecisionInput {
  patchId: string;
  decision: "apply" | "dismiss";
  afterValue?: string;
  reviewer: string;
}

export interface RepairDecisionResult {
  ok: boolean;
  message: string;
  patchId?: string;
  status?: string;
  appliedValue?: string;
}

interface RepairPatchRow {
  id: string;
  thread_id: string;
  run_id: string;
  dataset_id: string;
  row_index: number;
  field: string;
  before_value: string;
  after_value: string;
  status: string;
  confidence: number;
}

export function decideRepairPatch(input: RepairDecisionInput): RepairDecisionResult {
  const db = getDb();
  const patch = db
    .prepare("SELECT * FROM repair_patch WHERE id = :id LIMIT 1")
    .get({ id: input.patchId }) as RepairPatchRow | null;
  if (!patch) {
    return { ok: false, message: "未找到该修复提案。" };
  }
  if (!PENDING_STATUSES.has(patch.status)) {
    return { ok: false, message: `修复提案状态为「${patch.status}」，不能重复决策。` };
  }

  const now = workspaceNow();
  const edited = input.afterValue !== undefined && input.afterValue.trim() !== patch.after_value;
  const finalValue = (input.afterValue ?? patch.after_value).trim();

  if (input.decision === "apply") {
    if (!finalValue) {
      return { ok: false, message: "修复值不能为空。可以先编辑再采纳。" };
    }
    const writeResult = applyPatchToDataset(db, patch, finalValue, now);
    if (!writeResult.ok) return { ok: false, message: writeResult.message };

    db.prepare(
      "UPDATE repair_patch SET status = 'applied', after_value = :after WHERE id = :id",
    ).run({ after: finalValue, id: patch.id });
  } else {
    db.prepare("UPDATE repair_patch SET status = 'dismissed' WHERE id = :id").run({ id: patch.id });
  }

  const approved = input.decision === "apply";
  logDecision(db, {
    thread_id: patch.thread_id,
    run_id: patch.run_id,
    target_type: "repair_patch",
    target_id: patch.id,
    decision: approved ? "human_approved" : "human_rejected",
    reason_codes: approved
      ? [edited ? "human_edited_repair" : "human_applied_repair"]
      : ["human_dismissed_repair"],
    context: {
      field: patch.field,
      row_index: patch.row_index,
      before_value: patch.before_value,
      after_value: finalValue,
      confidence: patch.confidence,
      edited,
    },
    actor_type: "human",
    actor_id: input.reviewer,
  });

  return {
    ok: true,
    message: approved
      ? `已采纳${edited ? "（按你的修改值）" : ""}：第 ${patch.row_index + 1} 行 ${patch.field} 已回写数据集，重跑核查即按修复后数据。`
      : "已忽略该修复提案，决策日志已留痕。",
    patchId: patch.id,
    status: approved ? "applied" : "dismissed",
    appliedValue: approved ? finalValue : undefined,
  };
}

// 把修复值真正写回数据集（rows_json 对应行）；列名优先取本次 run 的字段映射，缺列则补列。
function applyPatchToDataset(
  db: ReturnType<typeof getDb>,
  patch: RepairPatchRow,
  value: string,
  now: string,
): { ok: boolean; message: string } {
  void now;
  const dataset = db
    .prepare("SELECT id, columns_json, rows_json FROM uploaded_dataset WHERE id = :id LIMIT 1")
    .get({ id: patch.dataset_id }) as { id: string; columns_json: string; rows_json: string } | null;
  if (!dataset) return { ok: false, message: "未找到该提案对应的数据集。" };

  let rows: Array<Record<string, string>>;
  let columns: string[];
  try {
    rows = JSON.parse(dataset.rows_json) as Array<Record<string, string>>;
    columns = JSON.parse(dataset.columns_json) as string[];
  } catch {
    return { ok: false, message: "数据集内容解析失败。" };
  }
  if (!Array.isArray(rows) || patch.row_index < 0 || patch.row_index >= rows.length) {
    return { ok: false, message: `数据集中没有第 ${patch.row_index + 1} 行。` };
  }

  const mapping = db
    .prepare(
      `SELECT source_column FROM field_mapping
       WHERE run_id = :run_id AND target_field = :field AND status = 'inferred'
       ORDER BY confidence DESC LIMIT 1`,
    )
    .get({ run_id: patch.run_id, field: patch.field }) as { source_column: string } | null;
  const column = mapping?.source_column ?? FIELD_COLUMN_FALLBACK[patch.field] ?? patch.field;

  if (!columns.includes(column)) columns.push(column);
  rows[patch.row_index] = { ...rows[patch.row_index], [column]: value };

  db.prepare(
    "UPDATE uploaded_dataset SET rows_json = :rows, columns_json = :columns WHERE id = :id",
  ).run({ rows: JSON.stringify(rows), columns: JSON.stringify(columns), id: dataset.id });
  return { ok: true, message: "" };
}
