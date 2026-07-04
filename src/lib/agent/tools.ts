import "server-only";
import {
  CODE_ALIASES,
  PRICE_CATALOG,
  PROCUREMENT_CHANNELS,
  RETAIL_CHANNELS,
  RETAIL_COMPARE_CHANNELS,
  RETAIL_PRICE_MULTIPLIER,
  matchCatalogByName,
  packRatioContextFor,
  warningTierFor,
  type PackRatioContext,
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
  // R8 异常低价：低于参考价 50%（低价恶性竞争/「降价死」信号，风险预警覆盖高低两端）
  tooLow: boolean;
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

export interface SpecRatioFinding {
  // 是否适用差比价折算（归并组内非代表品 + 机构挂网渠道 + 单价可解析）
  applicable: boolean;
  over: boolean;
  ctx: PackRatioContext | null;
  detail: string;
}

export interface RetailFinding {
  // 是否适用 1.3 倍比对（机构采购渠道 + 目录项配有零售集中价 + 单价可解析）
  applicable: boolean;
  over: boolean;
  retailPrice: number | null;
  limit: number | null;
  // 零售/网售渠道的无编码行：名称对应候选（编码回写需人工确认）
  isRetailChannel: boolean;
  noCode: boolean;
  nameMatch: { code: string; name: string; confidence: number } | null;
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
  // 零售/网售渠道价天然无医保编码（R6 按名称对应），item_code 不作为必填。
  const retailChannel = (RETAIL_CHANNELS as readonly string[]).includes(
    row.procurement_channel,
  );
  const required: Array<keyof CandidateRow> = [
    "item_name",
    "price_date",
    "procurement_channel",
    "region",
    "unit_price",
  ];
  if (!retailChannel) required.unshift("item_code");
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
        tooLow: false,
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
  // R8 异常低价：机构挂网/议价渠道低于参考价 50%（价格风险预警覆盖高低两端，防低价恶性
  // 竞争与「降价死」）。集采中选渠道豁免——中选价深度低于参考价是集采结果，不是异常。
  const institutionalChannel = (RETAIL_COMPARE_CHANNELS as readonly string[]).includes(
    row.procurement_channel,
  );
  const tooLow =
    !overCeiling && !spike && institutionalChannel && price < item.referencePrice * 0.5;
  const ok = !overCeiling && !spike && !tooLow;
  // 苏医保发〔2021〕64号红黄预警分档：按相对基准价的倍数标注提醒/约谈/暂停交易档位。
  const tier = overCeiling ? warningTierFor(price / item.ceilingPrice) : null;
  const detail = overCeiling
    ? `单价 ${price.toFixed(2)} 高于最高有效价 ${item.ceilingPrice.toFixed(2)}（${(price / item.ceilingPrice).toFixed(1)} 倍${tier ? ` → ${tier.label}：${tier.action}` : ""}）`
    : spike
      ? `单价 ${price.toFixed(2)} 较参考价 ${item.referencePrice.toFixed(2)} 涨幅超过 15%`
      : tooLow
        ? `单价 ${price.toFixed(2)} 低于参考价 ${item.referencePrice.toFixed(2)} 的 50%（异常低价信号，需核实报价真实性与供应可持续性）`
        : `单价 ${price.toFixed(2)} 在参考区间内`;
  return {
    finding: {
      ok,
      price,
      reference: item.referencePrice,
      ceiling: item.ceilingPrice,
      overCeiling,
      spike,
      tooLow,
      detail,
    },
    call: tc(
      "reference_price_monitor",
      "参考价动态监测",
      `item_code=${code}, unit_price=${row.unit_price}`,
      detail,
      ok,
      overCeiling ? "price_over_ceiling" : spike ? "price_spike" : tooLow ? "price_below_floor" : undefined,
    ),
  };
}

// ===== R6 零售比价：机构采购价 vs 零售药店/网售平台集中价 1.3 倍上限 =====
// 「不能高于当地零售药店和互联网销售平台集中价格的 1.3 倍」是政策落地里最难的一条：
// 零售价没有医保编码，先按名称对应（人审确认），对应上了才可比。
export function retailPriceComparator(row: CandidateRow): {
  finding: RetailFinding;
  call: ToolCall;
} {
  const isRetailChannel = (RETAIL_CHANNELS as readonly string[]).includes(
    row.procurement_channel,
  );
  const rawCode = row.item_code.trim();
  const noCode = !rawCode;

  // 零售/网售渠道行：本身是比价基准来源，不做 1.3 倍校验；无编码时给出名称对应候选。
  if (isRetailChannel) {
    const nameMatch = noCode ? matchCatalogByName(row.item_name) : null;
    const detail = noCode
      ? nameMatch
        ? `零售渠道价无医保编码，按名称对应到 ${nameMatch.code}（${nameMatch.name}），置信度 ${Math.round(nameMatch.confidence * 100)}%，编码回写需人工确认`
        : `零售渠道价无医保编码，名称「${row.item_name}」未能对应到价格目录`
      : "零售渠道价已带编码，直接纳入多渠道比价基准";
    return {
      finding: {
        applicable: false,
        over: false,
        retailPrice: parsePrice(row.unit_price),
        limit: null,
        isRetailChannel,
        noCode,
        nameMatch,
        detail,
      },
      call: tc(
        "retail_price_comparator",
        "零售集中价比对",
        `channel=${row.procurement_channel}, item_name=${row.item_name}`,
        detail,
        !noCode || Boolean(nameMatch),
        noCode ? (nameMatch ? "retail_price_no_code" : "retail_price_unmatched") : undefined,
      ),
    };
  }

  const code = canonicalCode(rawCode);
  const item = code ? PRICE_CATALOG[code] : null;
  const price = parsePrice(row.unit_price);
  const retailPrice = item?.retailCollectivePrice ?? null;
  const applicable =
    Boolean(item) &&
    retailPrice != null &&
    price !== null &&
    (RETAIL_COMPARE_CHANNELS as readonly string[]).includes(row.procurement_channel);

  if (!applicable) {
    return {
      finding: {
        applicable: false,
        over: false,
        retailPrice,
        limit: retailPrice != null ? retailPrice * RETAIL_PRICE_MULTIPLIER : null,
        isRetailChannel: false,
        noCode,
        nameMatch: null,
        detail: "无零售集中价基准或非机构采购渠道，跳过 1.3 倍比对",
      },
      call: tc(
        "retail_price_comparator",
        "零售集中价比对",
        `channel=${row.procurement_channel}, unit_price=${row.unit_price}`,
        "不适用零售比价",
        true,
      ),
    };
  }

  const limit = retailPrice! * RETAIL_PRICE_MULTIPLIER;
  const over = price! > limit;
  const detail = over
    ? `机构价 ${price!.toFixed(2)} 高于零售集中价 ${retailPrice!.toFixed(2)} 的 ${RETAIL_PRICE_MULTIPLIER} 倍上限 ${limit.toFixed(2)}`
    : `机构价 ${price!.toFixed(2)} 在零售集中价 ${RETAIL_PRICE_MULTIPLIER} 倍上限内（≤${limit.toFixed(2)}）`;
  return {
    finding: {
      applicable: true,
      over,
      retailPrice,
      limit,
      isRetailChannel: false,
      noCode,
      nameMatch: null,
      detail,
    },
    call: tc(
      "retail_price_comparator",
      "零售集中价比对",
      `item_code=${code}, channel=${row.procurement_channel}, unit_price=${row.unit_price}`,
      detail,
      !over,
      over ? "retail_over_1p3x" : undefined,
    ),
  };
}

// ===== R7 差比价折算：同通用名不同包装数量按 2452号公式折算后比价 =====
// 「大剂型小剂型的归类可能还涉及到差比价的计算」——48粒装不能直接和 24粒装比单价，
// 先算 K = 1.95^log₂X 得到可比价上限，超限的进入需核验（约谈/督促调价是人的决定）。
export function specRatioComparator(row: CandidateRow): {
  finding: SpecRatioFinding;
  call: ToolCall;
} {
  const code = canonicalCode(row.item_code);
  const price = parsePrice(row.unit_price);
  const institutional = (RETAIL_COMPARE_CHANNELS as readonly string[]).includes(
    row.procurement_channel,
  );
  const ctx = code ? packRatioContextFor(code) : null;

  if (!ctx || price === null || !institutional) {
    return {
      finding: {
        applicable: false,
        over: false,
        ctx: null,
        detail: "非差比价归并组非代表品或非机构挂网渠道，跳过差比价折算",
      },
      call: tc(
        "spec_ratio_comparator",
        "差比价折算",
        `item_code=${row.item_code}, channel=${row.procurement_channel}`,
        "不适用差比价折算",
        true,
      ),
    };
  }

  // 浮点保护：以万分之一为容差
  const over = price > ctx.limit * 1.0001;
  const detail = over
    ? `差比价超限：${row.item_name}（${ctx.packCount}粒装）申报价 ${price.toFixed(2)} 高于可比价上限 ${ctx.limit.toFixed(2)}。折算依据：代表品「${ctx.repName}」价 ${ctx.repPrice.toFixed(2)}，${ctx.formula}`
    : `差比价合规：申报价 ${price.toFixed(2)} ≤ 可比价上限 ${ctx.limit.toFixed(2)}（代表品「${ctx.repName}」× K=${ctx.k.toFixed(3)}）`;
  return {
    finding: { applicable: true, over, ctx, detail },
    call: tc(
      "spec_ratio_comparator",
      "差比价折算",
      `item_code=${code}, pack=${ctx.packCount}/${ctx.repPackCount}, unit_price=${row.unit_price}`,
      detail,
      !over,
      over ? "spec_over_ratio" : undefined,
    ),
  };
}

export function collectiveLandingTracker(row: CandidateRow): {
  finding: CollectiveFinding;
  call: ToolCall;
} {
  const channelKnown =
    (PROCUREMENT_CHANNELS as readonly string[]).includes(row.procurement_channel) ||
    (RETAIL_CHANNELS as readonly string[]).includes(row.procurement_channel);
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
  "retail_price_comparator",
  "spec_ratio_comparator",
  "anomaly_profiler",
] as const;

export interface RowFindings {
  schema: SchemaFinding;
  standard: StandardFinding;
  price: PriceFinding;
  collective: CollectiveFinding;
  retail: RetailFinding;
  specRatio: SpecRatioFinding;
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
  const retail = retailPriceComparator(row).finding;
  const specRatio = specRatioComparator(row).finding;
  const anomaly = anomalyProfiler(row, releaseDate).finding;
  const findings: RowFindings = { schema, standard, price, collective, retail, specRatio, anomaly };

  let verdict: RowVerdict;
  // R6 零售/网售无编码行：先于 schema 判断——缺编码是该渠道的常态，不是字段缺失异常。
  // 名称能对应 → 纠错候选（编码回写需人工确认）；对应不上 → 需核验，绝不自动落地。
  if (retail.isRetailChannel && retail.noCode && row.item_name.trim()) {
    if (retail.nameMatch) {
      verdict = {
        state: "纠错候选",
        issueType: "retail_price_no_code",
        severity: "medium",
        sourceRule: "R6 零售/网售渠道价按名称对应，编码回写需人工确认",
        confidence: retail.nameMatch.confidence,
        detectedFields: ["item_code", "item_name", "procurement_channel"],
        writer: "correction",
        issueText: retail.detail,
        recommendation:
          "人工确认名称↔编码对应关系后回写标准编码，该零售价随即纳入多渠道比价基准。",
        suggestion: retail.nameMatch.code,
      };
    } else {
      verdict = {
        state: "需核验",
        issueType: "retail_price_unmatched",
        severity: "medium",
        sourceRule: "R6 零售/网售渠道价按名称对应",
        confidence: 0.6,
        detectedFields: ["item_name", "procurement_channel"],
        writer: "approval",
        issueText: retail.detail,
        recommendation: "转目录维护人工检索对应编码；对应不上前该价格不进入比价结论。",
      };
    }
    return { verdict, findings };
  }
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
  } else if (retail.over) {
    verdict = {
      state: "异常处置",
      issueType: "retail_over_1p3x",
      severity: "high",
      sourceRule: "R6 挂网/采购价不得高于零售「即时达」集中价 1.3 倍（国办发〔2026〕9号）",
      confidence: 0.95,
      detectedFields: ["unit_price", "procurement_channel"],
      writer: "quarantine",
      issueText: retail.detail,
      recommendation:
        "生成零售比价核实口径：核对零售/网售集中价采集口径与机构执行价，超上限部分要求机构说明或启动调价。",
    };
  } else if (specRatio.over) {
    verdict = {
      state: "需核验",
      issueType: "spec_over_ratio",
      severity: "medium",
      sourceRule: "R7 同通用名不同包装按差比价折算后比价（发改价格〔2011〕2452号）",
      confidence: 0.9,
      detectedFields: ["item_code", "unit_price"],
      writer: "approval",
      issueText: specRatio.detail,
      recommendation:
        "路由价格招采条线核验规格/包装折算口径，确认超限后督促企业调整挂网价至差比价上限内。",
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
  } else if (price.tooLow) {
    // 排在编码纠错之后：别名行的比价基准要等编码人工确认回写才可信（先标化再比价）。
    verdict = {
      state: "需核验",
      issueType: "price_below_floor",
      severity: "medium",
      sourceRule: "R8 执行价低于参考价 50% 视为异常低价信号（风险预警覆盖高低两端）",
      confidence: 0.75,
      detectedFields: ["unit_price"],
      writer: "approval",
      issueText: price.detail,
      recommendation:
        "路由价格监测岗核实：是否集采降价/赠送政策等正当原因；排除低价恶性竞争与「降价死」断供风险后确认落地。",
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
  retail_price_comparator: "零售集中价比对",
  spec_ratio_comparator: "差比价折算",
  anomaly_profiler: "异常画像",
  correction_writer: "纠错提案写入",
  quarantine_writer: "异常处置写入",
  approval_router: "核验任务路由",
  replay_builder: "回放组装",
};
