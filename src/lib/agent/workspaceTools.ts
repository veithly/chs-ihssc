import "server-only";
import {
  CODE_ALIASES,
  PRICE_CATALOG,
  PROCUREMENT_CHANNELS,
  REGION_OPTIONS,
} from "../fixtures";
import { classifyRow, type CandidateRow } from "./tools";

export type RawWorkspaceRow = Record<string, string>;

export interface InferredFieldMapping {
  source_column: string;
  target_field: string;
  confidence: number;
  status: "inferred" | "needs_user" | "ignored";
  reason: string;
}

export interface WorkspaceRow {
  rowIndex: number;
  raw: RawWorkspaceRow;
  item_code: string;
  item_name: string;
  price_date: string;
  procurement_channel: string;
  region: string;
  unit_price: string;
  institution_name: string;
  package_unit: string;
}

export interface ComputedRepairPatch {
  row_index: number;
  field: string;
  before_value: string;
  after_value: string;
  status: "applied" | "proposed" | "needs_user";
  reason: string;
  confidence: number;
}

export interface ComputedMatchGroup {
  group_key: string;
  item_name: string;
  row_indexes: number[];
  status: "ready" | "needs_user" | "excluded";
  reasons: string[];
}

export interface ComputedUnitConversion {
  group_key: string;
  source_unit: string;
  target_unit: string;
  formula: string;
  converted_count: number;
  status: "ready" | "needs_user";
}

export interface ComputedPriceBasis {
  group_key: string;
  basis: Record<string, unknown>;
}

export interface ComputedRuleEvaluation {
  group_key: string;
  result: string;
  reason_code: string;
  detail: string;
}

export interface ComputedDisposition {
  group_key: string | null;
  row_index: number;
  item_name: string;
  institution_name: string;
  issue_type: string;
  severity: string;
  status: string;
  next_action: string;
}

export interface WorkspaceToolResult {
  mappings: InferredFieldMapping[];
  normalizedRows: WorkspaceRow[];
  repairs: ComputedRepairPatch[];
  groups: ComputedMatchGroup[];
  conversions: ComputedUnitConversion[];
  basisPacks: ComputedPriceBasis[];
  evaluations: ComputedRuleEvaluation[];
  dispositions: ComputedDisposition[];
  questions: string[];
  stats: {
    rows: number;
    mappedFields: number;
    repairs: number;
    groups: number;
    conversions: number;
    dispositions: number;
    tasks: number;
  };
}

const FIELD_ALIASES: Record<string, string[]> = {
  item_code: ["item_code", "医保项目编码", "项目编码", "编码", "code", "耗材编码", "药品编码"],
  item_name: ["item_name", "药品耗材名称", "药品/耗材名称", "药品或耗材名称", "项目名称", "名称", "name"],
  price_date: ["price_date", "价格日期", "监测日期", "采集日期", "日期", "date"],
  procurement_channel: ["procurement_channel", "采购渠道", "价格渠道", "渠道", "channel", "价格类型"],
  region: ["region", "地区", "省份", "城市", "区域", "region"],
  unit_price: ["unit_price", "单价", "价格", "执行价", "机构执行价", "中选价", "price"],
  institution_name: ["institution_name", "机构", "医疗机构", "医院", "机构名称"],
  package_unit: ["package_unit", "包装单位", "单位", "计价单位", "unit"],
};

const REQUIRED = ["item_code", "item_name", "unit_price"] as const;

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_\-—/（）()]/g, "");
}

function targetFor(column: string): { field: string; confidence: number } | null {
  const normalized = normalizeHeader(column);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (normalized === normalizeHeader(alias)) return { field, confidence: 0.96 };
    }
  }
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(normalizeHeader(alias)))) {
      return { field, confidence: 0.74 };
    }
  }
  return null;
}

export function inferFieldMappings(columns: string[]): InferredFieldMapping[] {
  const used = new Set<string>();
  const mappings: InferredFieldMapping[] = columns.map((column) => {
    const target = targetFor(column);
    if (!target || used.has(target.field)) {
      return {
        source_column: column,
        target_field: "",
        confidence: target?.confidence ?? 0.2,
        status: "ignored" as const,
        reason: target ? "该业务字段已有更高置信列，暂不重复映射。" : "未识别为 P0 价格治理字段。",
      };
    }
    used.add(target.field);
    return {
      source_column: column,
      target_field: target.field,
      confidence: target.confidence,
      status: "inferred" as const,
      reason: `按表头别名映射到 ${target.field}。`,
    };
  });

  for (const required of REQUIRED) {
    if (!used.has(required)) {
      mappings.push({
        source_column: "待用户确认",
        target_field: required,
        confidence: 0,
        status: "needs_user",
        reason:
          required === "unit_price"
            ? "未找到机构执行价/单价列，需要用户指出。"
            : `未找到 ${required} 对应列，需要补充。`,
      });
    }
  }

  return mappings;
}

function valueFor(
  raw: RawWorkspaceRow,
  mappings: InferredFieldMapping[],
  targetField: string,
): string {
  const mapping = mappings.find(
    (m) => m.target_field === targetField && m.status === "inferred",
  );
  return mapping ? String(raw[mapping.source_column] ?? "").trim() : "";
}

function canonicalCode(code: string): string | null {
  const trimmed = code.trim();
  if (PRICE_CATALOG[trimmed]) return trimmed;
  return CODE_ALIASES[trimmed] ?? null;
}

function priceFor(value: string): number | null {
  const n = Number(value.replace(/[,\s元]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function institutionFor(row: WorkspaceRow): string {
  if (row.institution_name) return row.institution_name;
  if (row.rowIndex % 4 === 0) return "市人民医院";
  if (row.rowIndex % 4 === 1) return "省立医院";
  if (row.rowIndex % 4 === 2) return "区中心医院";
  return "基层医疗机构";
}

function nextActionFor(issueType: string): string {
  if (issueType === "item_code_correctable") return "转目录维护确认，确认后回写标准编码。";
  if (issueType.includes("collective")) return "生成集采落地催办口径，交集采落地专班复核。";
  if (issueType.includes("price")) return "生成机构核实口径，要求补充执行价凭证。";
  if (issueType.includes("schema") || issueType.includes("date")) return "先发起数据治理确认，补齐来源口径后再核价。";
  if (issueType.includes("catalog")) return "发起目录编码确认，不直接形成价格异常结论。";
  return "进入待确认处置篮。";
}

function taskStatusFor(issueType: string): string {
  if (issueType === "item_code_correctable") return "待修复";
  if (issueType.includes("schema")) return "待字段映射";
  if (issueType.includes("collective")) return "待发起";
  if (issueType.includes("price")) return "待确认";
  return "可处置";
}

function normalizeRows(rawRows: RawWorkspaceRow[], mappings: InferredFieldMapping[]): WorkspaceRow[] {
  return rawRows.map((raw, i) => ({
    rowIndex: i,
    raw,
    item_code: valueFor(raw, mappings, "item_code"),
    item_name: valueFor(raw, mappings, "item_name"),
    price_date: valueFor(raw, mappings, "price_date") || new Date().toISOString().slice(0, 10),
    procurement_channel:
      valueFor(raw, mappings, "procurement_channel") || PROCUREMENT_CHANNELS[1],
    region: valueFor(raw, mappings, "region") || REGION_OPTIONS[1],
    unit_price: valueFor(raw, mappings, "unit_price"),
    institution_name: valueFor(raw, mappings, "institution_name"),
    package_unit: valueFor(raw, mappings, "package_unit"),
  }));
}

export function runWorkspaceTools(
  rawRows: RawWorkspaceRow[],
  columns: string[],
  releaseDate = new Date().toISOString().slice(0, 10),
): WorkspaceToolResult {
  const mappings = inferFieldMappings(columns);
  const normalizedRows = normalizeRows(rawRows, mappings);
  const repairs: ComputedRepairPatch[] = [];
  const dispositions: ComputedDisposition[] = [];
  const questions: string[] = [];
  const groupsByKey = new Map<string, WorkspaceRow[]>();

  if (mappings.some((m) => m.status === "needs_user" && m.target_field === "unit_price")) {
    questions.push("哪一列是机构执行价或本次要核验的价格列？");
  }

  for (const row of normalizedRows) {
    const code = canonicalCode(row.item_code);
    const item = code ? PRICE_CATALOG[code] : null;
    if (code && code !== row.item_code) {
      repairs.push({
        row_index: row.rowIndex,
        field: "item_code",
        before_value: row.item_code,
        after_value: code,
        status: "applied",
        reason: "命中价格目录高置信别名，先按标准编码生成修复 patch。",
        confidence: 0.94,
      });
    }
    if (item && row.item_name && row.item_name !== item.name) {
      repairs.push({
        row_index: row.rowIndex,
        field: "item_name",
        before_value: row.item_name,
        after_value: item.name,
        status: "proposed",
        reason: "编码已命中目录，项目名称与目录标准名不完全一致。",
        confidence: 0.86,
      });
    }
    if (!row.package_unit && item?.unit) {
      repairs.push({
        row_index: row.rowIndex,
        field: "package_unit",
        before_value: "",
        after_value: item.unit,
        status: "needs_user",
        reason: "表内未给包装单位，按目录单位预填但需要人工确认。",
        confidence: 0.68,
      });
    }

    const candidate: CandidateRow = {
      item_code: row.item_code,
      item_name: row.item_name,
      price_date: row.price_date,
      procurement_channel: row.procurement_channel,
      region: row.region,
      unit_price: row.unit_price,
    };
    const { verdict } = classifyRow(candidate, releaseDate);
    const groupKey = code ?? (row.item_name || `ROW-${row.rowIndex}`);
    if (!groupsByKey.has(groupKey)) groupsByKey.set(groupKey, []);
    groupsByKey.get(groupKey)!.push(row);
    if (verdict.issueType) {
      dispositions.push({
        group_key: groupKey,
        row_index: row.rowIndex,
        item_name: row.item_name || item?.name || "待补价格项目",
        institution_name: institutionFor(row),
        issue_type: verdict.issueType,
        severity: verdict.severity,
        status: taskStatusFor(verdict.issueType),
        next_action: nextActionFor(verdict.issueType),
      });
    }
  }

  const groups: ComputedMatchGroup[] = [];
  const conversions: ComputedUnitConversion[] = [];
  const basisPacks: ComputedPriceBasis[] = [];
  const evaluations: ComputedRuleEvaluation[] = [];

  for (const [groupKey, rows] of groupsByKey.entries()) {
    const item = PRICE_CATALOG[groupKey];
    const rowIndexes = rows.map((r) => r.rowIndex);
    const missingUnit = rows.some((r) => !r.package_unit);
    const priceValues = rows.map((r) => priceFor(r.unit_price)).filter((v): v is number => v !== null);
    const groupDispositions = dispositions.filter((d) => d.group_key === groupKey);
    const status = missingUnit ? "needs_user" : "ready";
    groups.push({
      group_key: groupKey,
      item_name: item?.name || rows[0]?.item_name || groupKey,
      row_indexes: rowIndexes,
      status,
      reasons: [
        item ? "按医保项目编码归并同品同规。" : "按名称候选归并，需人工确认编码。",
        rowIndexes.length > 1 ? `共 ${rowIndexes.length} 行可比。` : "单行进入价格口径核验。",
      ],
    });
    conversions.push({
      group_key: groupKey,
      source_unit: rows.find((r) => r.package_unit)?.package_unit || "待确认",
      target_unit: item?.unit || "目录单位待确认",
      formula: item?.unit
        ? `统一折算为目录单位「${item.unit}」，金额保留两位小数。`
        : "缺少标准目录单位，转数据治理确认。",
      converted_count: item ? rows.length : 0,
      status: item && !missingUnit ? "ready" : "needs_user",
    });
    basisPacks.push({
      group_key: groupKey,
      basis: {
        // 展示用快照（目录参考值）；漂移检测的 baseline 一律从 policy_fact 现读，不用这份快照。
        reference_price: item?.referencePrice ?? null,
        ceiling_price: item?.ceilingPrice ?? null,
        collective_price: item?.collectivePrice ?? null,
        landed_regions: item?.landedRegions ?? [],
        observed_min: priceValues.length ? Math.min(...priceValues) : null,
        observed_max: priceValues.length ? Math.max(...priceValues) : null,
        raw_item_code: rows[0]?.item_code ?? null,
        catalog_matched: Boolean(item),
      },
    });
    evaluations.push({
      group_key: groupKey,
      result:
        groupDispositions.length === 0
          ? "已排除"
          : groupDispositions.some((d) => d.severity === "high")
            ? "可处置"
            : "待确认",
      reason_code:
        groupDispositions[0]?.issue_type ||
        (item ? "no_blocking_price_issue" : "catalog_confirmation_required"),
      detail:
        groupDispositions.length === 0
          ? "未命中阻断性价格异常，进入动态监测。"
          : `命中 ${groupDispositions.length} 个待处理价格治理事项。`,
    });
  }

  const unitQuestions = conversions.filter((c) => c.status === "needs_user");
  if (unitQuestions.length > 0 && !questions.some((q) => q.includes("包装单位"))) {
    questions.push("缺包装单位的行是否先转数据治理确认？");
  }

  return {
    mappings,
    normalizedRows,
    repairs,
    groups,
    conversions,
    basisPacks,
    evaluations,
    dispositions,
    questions,
    stats: {
      rows: normalizedRows.length,
      mappedFields: mappings.filter((m) => m.status === "inferred").length,
      repairs: repairs.length,
      groups: groups.length,
      conversions: conversions.filter((c) => c.status === "ready").length,
      dispositions: dispositions.length,
      tasks: Math.max(dispositions.length, unitQuestions.length),
    },
  };
}
