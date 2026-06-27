import "server-only";
import {
  CODE_ALIASES,
  PRICE_CATALOG,
  PROCUREMENT_CHANNELS,
} from "../fixtures";
import type { ReleaseState, RowVerdict, ToolCall } from "../types";

export interface CandidateRow {
  item_code: string;
  item_name: string;
  price_date: string;
  procurement_channel: string;
  region: string;
  unit_price: string;
}

export interface SchemaFinding {
  ok: boolean;
  missing: string[];
}

export interface StandardFinding {
  valid: boolean;
  correctable: boolean;
  suggestion: string | null;
  itemName: string | null;
  nameMatched: boolean;
}

export interface PriceFinding {
  ok: boolean;
  price: number | null;
  reference: number | null;
  ceiling: number | null;
  overCeiling: boolean;
  spike: boolean;
  detail: string;
}

export interface CollectiveFinding {
  ok: boolean;
  channelKnown: boolean;
  notLanded: boolean;
  overCollective: boolean;
  detail: string;
}

export interface AnomalyFinding {
  anomaly: boolean;
  kind: string | null;
  detail: string;
}

function tc(
  tool: string,
  label: string,
  input: string,
  output: string,
  ok: boolean,
  finding?: string,
): ToolCall {
  return { tool, label, input, output, ok, finding };
}

function canonicalCode(code: string): string | null {
  const trimmed = code.trim();
  if (PRICE_CATALOG[trimmed]) return trimmed;
  return CODE_ALIASES[trimmed] ?? null;
}

function parsePrice(value: string): number | null {
  const normalized = value.replace(/[,\s元]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function schemaMapper(row: CandidateRow): {
  finding: SchemaFinding;
  call: ToolCall;
} {
  const required = [
    "item_code",
    "item_name",
    "price_date",
    "procurement_channel",
    "region",
    "unit_price",
  ] as const;
  const missing = required.filter((f) => !String(row[f] ?? "").trim());
  const ok = missing.length === 0;
  return {
    finding: { ok, missing },
    call: tc(
      "schema_mapper",
      "字段标化",
      `fields=${required.join(",")}`,
      ok ? "价格批次字段完整" : `缺失字段 ${missing.join(",")}`,
      ok,
      ok ? undefined : "schema_field_missing",
    ),
  };
}

export function priceCatalogStandardizer(row: CandidateRow): {
  finding: StandardFinding;
  call: ToolCall;
} {
  const rawCode = row.item_code.trim();
  const code = canonicalCode(rawCode);
  const valid = Boolean(PRICE_CATALOG[rawCode]);
  const correctable = !valid && Boolean(code);
  const item = code ? PRICE_CATALOG[code] : null;
  const nameMatched = Boolean(item && row.item_name.trim() === item.name);
  let output: string;
  if (valid && nameMatched) {
    output = `命中价格目录：${rawCode} = ${item?.name}`;
  } else if (valid) {
    output = `编码命中，名称可按目录规范为「${item?.name}」`;
  } else if (correctable) {
    output = `别名编码 ${rawCode} 可标准化为 ${code}（${item?.name}）`;
  } else {
    output = `未命中价格目录且无安全别名：${rawCode}`;
  }
  return {
    finding: {
      valid,
      correctable,
      suggestion: correctable ? code : valid && !nameMatched ? item?.name ?? null : null,
      itemName: item?.name ?? null,
      nameMatched,
    },
    call: tc(
      "price_catalog_standardizer",
      "价格目录标化",
      `item_code=${rawCode}, item_name=${row.item_name}`,
      output,
      valid && nameMatched,
      valid
        ? nameMatched
          ? undefined
          : "item_name_mismatch"
        : correctable
          ? "item_code_correctable"
          : "item_catalog_miss",
    ),
  };
}

export function referencePriceMonitor(row: CandidateRow): {
  finding: PriceFinding;
  call: ToolCall;
} {
  const code = canonicalCode(row.item_code);
  const item = code ? PRICE_CATALOG[code] : null;
  const price = parsePrice(row.unit_price);
  if (!item || price === null) {
    return {
      finding: {
        ok: false,
        price,
        reference: item?.referencePrice ?? null,
        ceiling: item?.ceilingPrice ?? null,
        overCeiling: price === null,
        spike: false,
        detail: price === null ? `单价无法解析：${row.unit_price}` : "价格项目无法匹配参考价",
      },
      call: tc(
        "reference_price_monitor",
        "参考价动态监测",
        `unit_price=${row.unit_price}`,
        price === null ? "单价格式异常" : "缺少参考价",
        false,
        price === null ? "price_invalid" : "item_catalog_miss",
      ),
    };
  }
  const overCeiling = price > item.ceilingPrice;
  const spike = !overCeiling && price > item.referencePrice * 1.15;
  const ok = !overCeiling && !spike;
  const detail = overCeiling
    ? `单价 ${price.toFixed(2)} 高于最高有效价 ${item.ceilingPrice.toFixed(2)}`
    : spike
      ? `单价 ${price.toFixed(2)} 较参考价 ${item.referencePrice.toFixed(2)} 涨幅超过 15%`
      : `单价 ${price.toFixed(2)} 在参考区间内`;
  return {
    finding: {
      ok,
      price,
      reference: item.referencePrice,
      ceiling: item.ceilingPrice,
      overCeiling,
      spike,
      detail,
    },
    call: tc(
      "reference_price_monitor",
      "参考价动态监测",
      `item_code=${code}, unit_price=${row.unit_price}`,
      detail,
      ok,
      overCeiling ? "price_over_ceiling" : spike ? "price_spike" : undefined,
    ),
  };
}

export function collectiveLandingTracker(row: CandidateRow): {
  finding: CollectiveFinding;
  call: ToolCall;
} {
  const channelKnown = (PROCUREMENT_CHANNELS as readonly string[]).includes(
    row.procurement_channel,
  );
  const code = canonicalCode(row.item_code);
  const item = code ? PRICE_CATALOG[code] : null;
  const price = parsePrice(row.unit_price);
  if (!channelKnown) {
    return {
      finding: {
        ok: false,
        channelKnown: false,
        notLanded: false,
        overCollective: false,
        detail: `未知采购/价格渠道：${row.procurement_channel}`,
      },
      call: tc(
        "collective_landing_tracker",
        "集采落地跟踪",
        `channel=${row.procurement_channel}`,
        "渠道未纳入治理策略",
        false,
        "procurement_channel_unknown",
      ),
    };
  }
  if (row.procurement_channel !== "集采中选-省平台" || !item || price === null) {
    return {
      finding: {
        ok: true,
        channelKnown,
        notLanded: false,
        overCollective: false,
        detail: "非集采中选价或缺少可比中选价，跳过落地校验",
      },
      call: tc(
        "collective_landing_tracker",
        "集采落地跟踪",
        `channel=${row.procurement_channel}`,
        "非集采落地路径",
        true,
      ),
    };
  }
  const landed = item.landedRegions.includes(row.region);
  const benchmark = item.collectivePrice ?? item.referencePrice;
  const overCollective = price > benchmark * 1.03;
  const ok = landed && !overCollective;
  const detail = !landed
    ? `${row.region} 不在该项目集采落地区域`
    : overCollective
      ? `集采价 ${price.toFixed(2)} 高于中选价 ${benchmark.toFixed(2)} 的 3% 容忍阈值`
      : `已在 ${row.region} 按中选价落地`;
  return {
    finding: { ok, channelKnown, notLanded: !landed, overCollective, detail },
    call: tc(
      "collective_landing_tracker",
      "集采落地跟踪",
      `region=${row.region}, channel=${row.procurement_channel}, unit_price=${row.unit_price}`,
      detail,
      ok,
      !landed
        ? "collective_not_landed"
        : overCollective
          ? "collective_price_overrun"
          : undefined,
    ),
  };
}

export function anomalyProfiler(
  row: CandidateRow,
  releaseDate: string,
): { finding: AnomalyFinding; call: ToolCall } {
  const priceAt = Date.parse(row.price_date);
  const rel = Date.parse(releaseDate);
  let anomaly = false;
  let kind: string | null = null;
  let detail = "价格日期在监测窗口内";
  if (Number.isNaN(priceAt)) {
    anomaly = true;
    kind = "date_unparseable";
    detail = `价格日期无法解析：${row.price_date}`;
  } else if (!Number.isNaN(rel) && priceAt > rel) {
    anomaly = true;
    kind = "future_price_date";
    detail = `价格日期 ${row.price_date} 晚于批次监测日 ${releaseDate}`;
  }
  return {
    finding: { anomaly, kind, detail },
    call: tc(
      "anomaly_profiler",
      "异常画像",
      `price_date=${row.price_date}, monitor_date=${releaseDate}`,
      anomaly ? detail : "未发现日期异常",
      !anomaly,
      anomaly ? "date_anomaly" : undefined,
    ),
  };
}

export const VALIDATORS = [
  "schema_mapper",
  "price_catalog_standardizer",
  "reference_price_monitor",
  "collective_landing_tracker",
  "anomaly_profiler",
] as const;

export interface RowFindings {
  schema: SchemaFinding;
  standard: StandardFinding;
  price: PriceFinding;
  collective: CollectiveFinding;
  anomaly: AnomalyFinding;
}

export function classifyRow(
  row: CandidateRow,
  releaseDate: string,
): { verdict: RowVerdict; findings: RowFindings } {
  const schema = schemaMapper(row).finding;
  const standard = priceCatalogStandardizer(row).finding;
  const price = referencePriceMonitor(row).finding;
  const collective = collectiveLandingTracker(row).finding;
  const anomaly = anomalyProfiler(row, releaseDate).finding;
  const findings: RowFindings = { schema, standard, price, collective, anomaly };

  let verdict: RowVerdict;
  if (!schema.ok) {
    verdict = {
      state: "异常处置",
      issueType: "schema_field_missing",
      severity: "high",
      sourceRule: "R-schema",
      confidence: 0.99,
      detectedFields: schema.missing,
      writer: "quarantine",
      issueText: `字段缺失：${schema.missing.join("、")}`,
      recommendation: "补齐价格治理字段后重新提交监测。",
    };
  } else if (anomaly.anomaly) {
    verdict = {
      state: "异常处置",
      issueType: "date_anomaly",
      severity: "high",
      sourceRule: "R1 价格日期不得晚于批次监测日",
      confidence: 0.99,
      detectedFields: ["price_date"],
      writer: "quarantine",
      issueText: anomaly.detail,
      recommendation: "修正价格日期或确认数据源推送周期后重新监测。",
    };
  } else if (!standard.valid && !standard.correctable) {
    verdict = {
      state: "异常处置",
      issueType: "item_catalog_miss",
      severity: "high",
      sourceRule: "R2 医保项目编码必须命中价格目录",
      confidence: 0.92,
      detectedFields: ["item_code", "item_name"],
      writer: "quarantine",
      issueText: `医保项目编码 ${row.item_code} 未命中价格目录且无安全别名。`,
      recommendation: "由目录/价格维护员确认标准编码后重新提交，当前行进入异常处置。",
    };
  } else if (price.overCeiling) {
    verdict = {
      state: "异常处置",
      issueType: price.price === null ? "price_invalid" : "price_over_ceiling",
      severity: "high",
      sourceRule: "R3 单价不得超过最高有效价",
      confidence: 0.97,
      detectedFields: ["unit_price"],
      writer: "quarantine",
      issueText: price.detail,
      recommendation: "冻结该价格记录，生成异常处置任务并要求数据源回传证明材料。",
    };
  } else if (collective.overCollective) {
    verdict = {
      state: "异常处置",
      issueType: "collective_price_overrun",
      severity: "high",
      sourceRule: "R3 集采中选价不得超过容忍阈值",
      confidence: 0.96,
      detectedFields: ["procurement_channel", "unit_price"],
      writer: "quarantine",
      issueText: collective.detail,
      recommendation: "进入集采价格异常处置，核对省平台落地价与医疗机构执行价。",
    };
  } else if (collective.notLanded || !collective.channelKnown) {
    verdict = {
      state: "需核验",
      issueType: collective.notLanded
        ? "collective_not_landed"
        : "procurement_channel_unknown",
      severity: "medium",
      sourceRule: "R4 集采中选价必须在已落地区域内落地",
      confidence: 0.72,
      detectedFields: ["procurement_channel", "region"],
      writer: "approval",
      issueText: collective.detail,
      recommendation: "路由至集采落地专班核验区域执行状态，核验前不自动落地。",
    };
  } else if (price.spike) {
    verdict = {
      state: "需核验",
      issueType: "price_spike",
      severity: "medium",
      sourceRule: "R5 参考价涨幅超过 15% 需核验",
      confidence: 0.78,
      detectedFields: ["unit_price"],
      writer: "approval",
      issueText: price.detail,
      recommendation: "路由价格监测岗核验是否为规格变更、政策调价或异常上报。",
    };
  } else if (!standard.valid && standard.correctable) {
    verdict = {
      state: "纠错候选",
      issueType: "item_code_correctable",
      severity: "medium",
      sourceRule: "R2 别名编码进入标准化纠错",
      confidence: 0.94,
      detectedFields: ["item_code"],
      writer: "correction",
      issueText: `医保项目编码 ${row.item_code} 可标准化为 ${standard.suggestion}（${standard.itemName}）。`,
      recommendation: "审核编码纠错提案，确认后按标准编码回写并重跑价格监测。",
      suggestion: standard.suggestion,
    };
  } else {
    verdict = {
      state: "可落地" as ReleaseState,
      issueType: "",
      severity: "low",
      sourceRule: "",
      confidence: 0.99,
      detectedFields: [],
      writer: null,
      issueText: "未发现阻断性价格问题，当前记录可进入落地跟踪台账。",
      recommendation: "可落地并持续进入动态监测。",
    };
  }
  return { verdict, findings };
}

export function aggregateState(byState: Record<string, number>): ReleaseState {
  if ((byState["异常处置"] ?? 0) > 0) return "异常处置";
  if ((byState["需核验"] ?? 0) > 0) return "需核验";
  if ((byState["纠错候选"] ?? 0) > 0) return "纠错候选";
  return "可落地";
}

export const TOOL_LABELS: Record<string, string> = {
  schema_mapper: "字段标化",
  price_catalog_standardizer: "价格目录标化",
  reference_price_monitor: "参考价动态监测",
  collective_landing_tracker: "集采落地跟踪",
  anomaly_profiler: "异常画像",
  correction_writer: "纠错提案写入",
  quarantine_writer: "异常处置写入",
  approval_router: "核验任务路由",
  replay_builder: "回放组装",
};
