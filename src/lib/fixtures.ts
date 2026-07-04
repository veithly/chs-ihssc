// Synthetic 医药价格治理 fixtures. All rows are fabricated and carry no real
// patient or institution data. The batches mimic daily price-governance work:
// price item standardization, procurement-channel monitoring, dynamic anomaly
// detection, collective-procurement landing, and closed-loop routing.

export const SCHEMA_VERSION = "price-schema-v1.0";
export const CODE_DICTIONARY_VERSION = "nhsa-price-catalog-v2026.06";
export const TOKEN_METHOD = "synthetic item master + regional reference prices";
export const ACCESS_POLICY_VERSION = "price-governance-policy-v2026.06";
export const RELEASE_RULE_VERSION = "price-rule-pack-v2026.06";

export const SCHEMA_FIELDS = [
  { field: "item_code", label: "医保项目编码", type: "nhsa_item_code" },
  { field: "item_name", label: "药品/耗材名称", type: "medical_item_name" },
  { field: "price_date", label: "价格日期", type: "date" },
  { field: "procurement_channel", label: "采购/价格渠道", type: "procurement_channel" },
  { field: "region", label: "地区", type: "province_or_city" },
  { field: "unit_price", label: "单价（元）", type: "decimal_yuan" },
];

export interface PriceCatalogItem {
  name: string;
  category: "药品" | "医用耗材";
  unit: string;
  referencePrice: number;
  ceilingPrice: number;
  collectivePrice?: number;
  // 零售药店/网售平台集中价格（监测口径）：机构采购价不得高于其 1.3 倍。
  retailCollectivePrice?: number;
  // 差比价归并组（发改价格〔2011〕2452号）：同通用名同剂型同含量、仅包装数量不同。
  comparableGroup?: string;
  // 最小零售包装内的制剂数量（粒/片），差比价折算用。
  packCount?: number;
  // 代表品（常用包装规格），组内非代表品按差比价公式从它折算可比价。
  isRepresentative?: boolean;
  landedRegions: string[];
}

export const PRICE_CATALOG: Record<string, PriceCatalogItem> = {
  "YP-AXL-001": {
    name: "阿莫西林胶囊 0.25g*24粒",
    category: "药品",
    unit: "盒",
    referencePrice: 8.72,
    ceilingPrice: 13.5,
    collectivePrice: 6.88,
    retailCollectivePrice: 9.6,
    comparableGroup: "阿莫西林胶囊 0.25g",
    packCount: 24,
    isRepresentative: true,
    landedRegions: ["上海市", "江苏省", "浙江省", "安徽省"],
  },
  // 同通用名同含量的大包装规格：只有过差比价折算才可与 24 粒代表品比价。
  "YP-AXL-005": {
    name: "阿莫西林胶囊 0.25g*48粒",
    category: "药品",
    unit: "盒",
    referencePrice: 15.8,
    ceilingPrice: 26,
    collectivePrice: 12.9,
    comparableGroup: "阿莫西林胶囊 0.25g",
    packCount: 48,
    landedRegions: ["上海市", "江苏省", "浙江省", "安徽省"],
  },
  "YP-AMT-002": {
    name: "阿托伐他汀钙片 20mg*14片",
    category: "药品",
    unit: "盒",
    referencePrice: 18.9,
    ceilingPrice: 28,
    collectivePrice: 13.86,
    retailCollectivePrice: 19.9,
    landedRegions: ["北京市", "天津市", "河北省", "上海市"],
  },
  "YP-INS-003": {
    name: "门冬胰岛素注射液 3ml:300单位",
    category: "药品",
    unit: "支",
    referencePrice: 43.2,
    ceilingPrice: 58,
    collectivePrice: 37.85,
    landedRegions: ["广东省", "广西壮族自治区", "海南省", "上海市"],
  },
  "YP-OMZ-004": {
    name: "奥美拉唑肠溶胶囊 20mg*28粒",
    category: "药品",
    unit: "盒",
    referencePrice: 11.4,
    ceilingPrice: 17.2,
    collectivePrice: 8.96,
    retailCollectivePrice: 12.4,
    landedRegions: ["四川省", "重庆市", "云南省", "贵州省"],
  },
  "HC-STN-901": {
    name: "冠脉药物洗脱支架",
    category: "医用耗材",
    unit: "个",
    referencePrice: 698,
    ceilingPrice: 890,
    collectivePrice: 590,
    landedRegions: ["上海市", "江苏省", "浙江省", "广东省"],
  },
  "HC-LNS-902": {
    name: "人工晶体 单焦点",
    category: "医用耗材",
    unit: "片",
    referencePrice: 780,
    ceilingPrice: 980,
    collectivePrice: 640,
    landedRegions: ["北京市", "天津市", "河北省", "山东省"],
  },
  "HC-BLN-903": {
    name: "一次性使用球囊扩张导管",
    category: "医用耗材",
    unit: "根",
    referencePrice: 1260,
    ceilingPrice: 1580,
    collectivePrice: 980,
    landedRegions: ["广东省", "福建省", "湖南省", "江西省"],
  },
  "HC-SRG-904": {
    name: "可吸收缝线 3-0",
    category: "医用耗材",
    unit: "包",
    referencePrice: 48,
    ceilingPrice: 72,
    collectivePrice: 36,
    landedRegions: ["上海市", "江苏省", "浙江省", "山东省"],
  },
};

export const CODE_DICTIONARY: Record<string, string> = Object.fromEntries(
  Object.entries(PRICE_CATALOG).map(([code, item]) => [code, item.name]),
);

export const CODE_ALIASES: Record<string, string> = {
  "YP-AXL-O01": "YP-AXL-001",
  "YP-AMT-OO2": "YP-AMT-002",
  "YP-INS-O03": "YP-INS-003",
  "YP-OMZ-OO4": "YP-OMZ-004",
  "HC-STN-9O1": "HC-STN-901",
  "HC-LNS-9O2": "HC-LNS-902",
  "HC-BLN-9O3": "HC-BLN-903",
  "HC-SRG-9O4": "HC-SRG-904",
};

const HARD_MISS_CODES = ["YP-UNKNOWN-999", "HC-LOCAL-000", "TMP-PRICE-404"];

export const PROCUREMENT_CHANNELS = [
  "集采中选-省平台",
  "省级挂网",
  "院内议价",
  "国谈药品",
  "阳光采购",
] as const;

// 零售监测渠道：价格没有医保编码，只有商品名——需按名称对应到目录后才可比价。
// 不进入随机干净行的渠道池，只在监测口径行中出现（确定性演示素材）。
export const RETAIL_CHANNELS = ["零售药店", "网上药店"] as const;

// 适用「不高于零售集中价 1.3 倍」比对的机构采购渠道（集采渠道走中选价校验，不重复比）。
export const RETAIL_COMPARE_CHANNELS = ["省级挂网", "院内议价", "阳光采购"] as const;

export const RETAIL_PRICE_MULTIPLIER = 1.3;

// 名称标化：去掉厂商/门店括注、统一乘号与空白，用于零售无编码价格的目录对应。
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[×xX]/g, "*")
    .replace(/毫克/g, "mg")
    .replace(/[\s\u3000·，,。.\-—_/]/g, "");
}

export interface CatalogNameMatch {
  code: string;
  name: string;
  confidence: number;
}

// 按名称把无编码的渠道价对应到医保项目编码。返回的是"候选"——
// 编码回写必须人工确认（对应关系是敏感判断，AI 只提议不定性）。
export function matchCatalogByName(rawName: string): CatalogNameMatch | null {
  const q = normalizeItemName(rawName);
  if (!q) return null;
  let best: CatalogNameMatch | null = null;
  for (const [code, item] of Object.entries(PRICE_CATALOG)) {
    const c = normalizeItemName(item.name);
    let confidence = 0;
    if (q === c) confidence = 0.93;
    else if (q.includes(c) || c.includes(q)) confidence = 0.78;
    else {
      // 通用名+剂型前缀匹配（去掉规格数字后比较）
      const qHead = q.replace(/[0-9].*$/, "");
      const cHead = c.replace(/[0-9].*$/, "");
      if (qHead && qHead.length >= 4 && qHead === cHead) confidence = 0.62;
    }
    if (confidence > (best?.confidence ?? 0)) {
      best = { code, name: item.name, confidence };
    }
  }
  return best && best.confidence >= 0.6 ? best : null;
}

// ===== 红黄预警分档（苏医保发〔2021〕64号《关于深入推进药品阳光采购的实施意见》）=====
// 相对已挂网同品种价的倍数分档：高出不足 2 倍黄色预警；2-5 倍红★；5-10 倍红★★；
// 10 倍(含)以上红★★★——暂停交易资格，原则上不得采购。预警标记每季度初更新。
export interface WarningTier {
  label: string;
  stars: number;
  color: "yellow" | "red";
  action: string;
}

export function warningTierFor(multiple: number): WarningTier | null {
  if (!Number.isFinite(multiple) || multiple <= 1) return null;
  if (multiple >= 10)
    return { label: "红色预警★★★", stars: 3, color: "red", action: "暂停交易资格，原则上不得采购" };
  if (multiple >= 5)
    return { label: "红色预警★★", stars: 2, color: "red", action: "约谈企业，提醒医疗机构谨慎采购" };
  if (multiple >= 2)
    return { label: "红色预警★", stars: 1, color: "red", action: "约谈企业，提醒医疗机构谨慎采购" };
  return { label: "黄色预警", stars: 0, color: "yellow", action: "提醒医疗机构关注价差" };
}

// ===== 差比价（发改价格〔2011〕2452号 第十三条 包装数量差比价）=====
// 口服片剂/胶囊剂：非代表品价 = 代表品价 × K，K = 1.95^(log₂X)，
// X = 非代表品包装数量 ÷ 代表品包装数量（包装数量翻倍，价格上限乘 1.95）。
export const PACK_RATIO_COEFF = 1.95;

export interface PackRatioContext {
  repCode: string;
  repName: string;
  repPrice: number;
  packCount: number;
  repPackCount: number;
  ratio: number;
  k: number;
  limit: number;
  formula: string;
}

export function packRatioContextFor(code: string): PackRatioContext | null {
  const item = PRICE_CATALOG[code];
  if (!item?.comparableGroup || !item.packCount || item.isRepresentative) return null;
  const repEntry = Object.entries(PRICE_CATALOG).find(
    ([, it]) => it.comparableGroup === item.comparableGroup && it.isRepresentative,
  );
  if (!repEntry || !repEntry[1].packCount) return null;
  const [repCode, rep] = repEntry;
  const ratio = item.packCount / rep.packCount!;
  const k = Math.pow(PACK_RATIO_COEFF, Math.log2(ratio));
  const limit = rep.referencePrice * k;
  return {
    repCode,
    repName: rep.name,
    repPrice: rep.referencePrice,
    packCount: item.packCount,
    repPackCount: rep.packCount!,
    ratio,
    k,
    limit,
    formula: `K = ${PACK_RATIO_COEFF}^log₂(${item.packCount}/${rep.packCount}) = ${k.toFixed(3)}；可比价上限 = ${rep.referencePrice.toFixed(2)} × ${k.toFixed(3)} = ${limit.toFixed(2)} 元`,
  };
}

export const REGION_OPTIONS = [
  "北京市",
  "上海市",
  "江苏省",
  "浙江省",
  "广东省",
  "四川省",
  "山东省",
  "河北省",
  "福建省",
  "湖南省",
];

export const PRICE_OPTIONS = [
  "6.88",
  "8.96",
  "13.86",
  "37.85",
  "590.00",
  "640.00",
  "980.00",
  "1260.00",
];

export const ACCESS_POLICY: Record<
  string,
  { regions: string[]; channels: string[]; note: string }
> = Object.fromEntries(
  PROCUREMENT_CHANNELS.map((channel) => [
    channel,
    {
      regions: REGION_OPTIONS,
      channels: [channel],
      note: "价格治理演示策略：渠道、地区、参考价、集采落地状态共同决定处置流向。",
    },
  ]),
);

export const DENIED_ROLE_HINT = ["新疆生产建设兵团", "港澳台地区"];
export const DENIED_PURPOSE_HINT = ["9999.00", "0", "未填"];
export const IDENTITY_REGISTRY = Object.keys(PRICE_CATALOG);

export const RELEASE_RULES = [
  "R1 价格日期不得晚于批次监测日。",
  "R2 医保项目编码必须命中价格目录，别名编码只进入纠错候选。",
  "R3 单价超过最高有效价或超过集采中选价容忍阈值时进入异常处置。",
  "R4 集采中选价必须在已落地区域内落地，未落地或跨区异常进入需核验。",
  "R5 相对参考价涨幅超过 15% 但未触发硬阈值时进入需核验。",
  "R6 挂网/采购价不得高于当地零售药店及网售平台「即时达」价格集中区间的 1.3 倍（国办发〔2026〕9号全渠道比价口径）；零售/网售渠道无编码价格按名称对应，编码回写需人工确认。",
  "R7 同通用名不同包装数量的挂网价先按差比价折算再比价：非代表品价 ≤ 代表品价 × 1.95^log₂X（发改价格〔2011〕2452号包装数量差比价），超限进入需核验。",
  "R8 执行/挂网价低于参考价 50% 视为异常低价信号进入需核验（价格风险预警覆盖异常高价与异常低价两端，防低价恶性竞争与「降价死」，国办发〔2026〕9号风险预警导向）。",
];

export interface FixtureRow {
  item_code: string;
  item_name: string;
  price_date: string;
  procurement_channel: string;
  region: string;
  unit_price: string;
}

export interface FixtureRelease {
  id: string;
  title: string;
  domain: string;
  publisher: string;
  version_label: string;
  record_count: number;
  release_date: string;
  is_sample: boolean;
  rows: FixtureRow[];
}

type IssueKind =
  | "future_date"
  | "hard_code"
  | "correctable"
  | "price_over_ceiling"
  // 极端超挂网基准 10 倍以上（苏医保发〔2021〕64号红色预警★★★：暂停交易资格档）
  | "price_over_10x"
  | "price_spike"
  | "collection_not_landed"
  | "collection_over_price"
  | "schema_missing"
  // 零售/网售监测口径行：无医保编码，只有商品名（名称带门店括注）
  | "retail_no_code"
  // 机构挂网价超零售集中价 1.3 倍（但不破最高有效价，命中 R6 而非 R3）
  | "retail_over_1p3x"
  // 大包装规格挂网价超差比价折算上限（2452号 K=1.95^log₂X，命中 R7）
  | "spec_over_ratio"
  // 异常低价：执行价低于参考价 50%（低价恶性竞争/「降价死」信号，命中 R8）
  | "price_below_floor";

interface BatchPlan {
  id: string;
  title: string;
  publisher: string;
  domain: string;
  record_count: number;
  release_date: string;
  is_sample: boolean;
  total: number;
  issues: Partial<Record<IssueKind, number>>;
}

const RETAIL_PRICED_CODES = Object.entries(PRICE_CATALOG)
  .filter(([, item]) => item.retailCollectivePrice != null)
  .map(([code]) => code);

// 差比价非代表品（有归并组且非代表品）：R7 演示素材的候选池。
const SPEC_RATIO_CODES = Object.entries(PRICE_CATALOG)
  .filter(([, item]) => item.comparableGroup && !item.isRepresentative)
  .map(([code]) => code);

const RETAIL_STORE_SUFFIXES = ["惠民大药房", "康泰连锁药店", "线上旗舰店"] as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function money(n: number): string {
  return n.toFixed(2);
}

function cleanPriceFor(
  rng: () => number,
  item: PriceCatalogItem,
  channel: string,
): string {
  if (channel === "集采中选-省平台" && item.collectivePrice) {
    return money(item.collectivePrice * (0.99 + rng() * 0.015));
  }
  return money(item.referencePrice * (0.92 + rng() * 0.12));
}

function buildBatch(plan: BatchPlan): FixtureRelease {
  const rng = mulberry32(seedFromId(plan.id));
  const rows: FixtureRow[] = [];
  const codes = Object.keys(PRICE_CATALOG);
  const aliasCodes = Object.keys(CODE_ALIASES);

  for (let i = 0; i < plan.total; i += 1) {
    const itemCode = pick(rng, codes);
    const item = PRICE_CATALOG[itemCode];
    const channel = pick(rng, PROCUREMENT_CHANNELS);
    const landed = item.landedRegions.length ? item.landedRegions : REGION_OPTIONS;
    const region =
      channel === "集采中选-省平台" ? pick(rng, landed) : pick(rng, REGION_OPTIONS);
    rows.push({
      item_code: itemCode,
      item_name: item.name,
      price_date: addDays(plan.release_date, -(1 + Math.floor(rng() * 9))),
      procurement_channel: channel,
      region,
      unit_price: cleanPriceFor(rng, item, channel),
    });
  }

  const issueList: IssueKind[] = [];
  (Object.keys(plan.issues) as IssueKind[]).forEach((k) => {
    for (let n = 0; n < (plan.issues[k] ?? 0); n += 1) issueList.push(k);
  });
  const taken = new Set<number>();
  // 问题行放进前 18 行：演示数据源（workspace）取每批前 18 行作为抽样窗口，
  // 保证漂移/复核/自动处置的演示素材一定在窗口内（确定性，不靠随机运气）。
  const issueCap = Math.min(plan.total, 18);
  const nextIndex = (): number => {
    let idx = Math.floor(rng() * issueCap);
    let guard = 0;
    while (taken.has(idx) && guard < issueCap * 3) {
      idx = (idx + 1) % issueCap;
      guard += 1;
    }
    taken.add(idx);
    return idx;
  };

  for (const kind of issueList) {
    const idx = nextIndex();
    const r = rows[idx];
    const canonical = CODE_ALIASES[r.item_code] ?? r.item_code;
    const item = PRICE_CATALOG[canonical] ?? PRICE_CATALOG[pick(rng, codes)];
    switch (kind) {
      case "future_date":
        r.price_date = addDays(plan.release_date, 2 + Math.floor(rng() * 8));
        break;
      case "hard_code":
        r.item_code = pick(rng, HARD_MISS_CODES);
        r.item_name = "未映射价格项目";
        break;
      case "correctable":
        r.item_code = pick(rng, aliasCodes);
        r.item_name = PRICE_CATALOG[CODE_ALIASES[r.item_code]].name;
        break;
      case "price_over_ceiling":
        r.unit_price = money(item.ceilingPrice * (1.18 + rng() * 0.2));
        break;
      case "price_over_10x":
        r.procurement_channel = "省级挂网";
        r.unit_price = money(item.ceilingPrice * (10.2 + rng() * 0.8));
        break;
      case "price_spike":
        r.procurement_channel = "省级挂网";
        r.unit_price = money(item.referencePrice * (1.16 + rng() * 0.08));
        break;
      case "price_below_floor":
        // 低于参考价 50%（35-45%），不触发其他上限类规则
        r.procurement_channel = "省级挂网";
        r.unit_price = money(item.referencePrice * (0.35 + rng() * 0.1));
        break;
      case "collection_not_landed": {
        r.procurement_channel = "集采中选-省平台";
        const outside = REGION_OPTIONS.find((x) => !item.landedRegions.includes(x));
        r.region = outside ?? "北京市";
        r.unit_price = money((item.collectivePrice ?? item.referencePrice) * 1.01);
        break;
      }
      case "collection_over_price":
        r.procurement_channel = "集采中选-省平台";
        r.region = pick(rng, item.landedRegions);
        r.unit_price = money((item.collectivePrice ?? item.referencePrice) * 1.12);
        break;
      case "schema_missing":
        r.item_code = "";
        break;
      case "retail_no_code": {
        const retailCode = pick(rng, RETAIL_PRICED_CODES);
        const retailItem = PRICE_CATALOG[retailCode];
        r.item_code = "";
        r.item_name = `${retailItem.name.replace("*", "×")}（${pick(rng, RETAIL_STORE_SUFFIXES)}）`;
        r.procurement_channel = pick(rng, RETAIL_CHANNELS);
        r.unit_price = money(
          (retailItem.retailCollectivePrice ?? retailItem.referencePrice) * (0.97 + rng() * 0.05),
        );
        break;
      }
      case "retail_over_1p3x": {
        const retailCode = pick(rng, RETAIL_PRICED_CODES);
        const retailItem = PRICE_CATALOG[retailCode];
        r.item_code = retailCode;
        r.item_name = retailItem.name;
        r.procurement_channel = "省级挂网";
        const retail = retailItem.retailCollectivePrice ?? retailItem.referencePrice;
        r.unit_price = money(
          Math.min(retail * RETAIL_PRICE_MULTIPLIER * (1.02 + rng() * 0.05), retailItem.ceilingPrice * 0.985),
        );
        break;
      }
      case "spec_over_ratio": {
        const specCode = pick(rng, SPEC_RATIO_CODES);
        const specItem = PRICE_CATALOG[specCode];
        const ctx = packRatioContextFor(specCode);
        r.item_code = specCode;
        r.item_name = specItem.name;
        r.procurement_channel = "省级挂网";
        const limit = ctx?.limit ?? specItem.referencePrice * 1.2;
        // 超差比价折算上限 10-22%，但不破最高有效价（命中 R7 而非 R3）
        r.unit_price = money(
          Math.min(limit * (1.1 + rng() * 0.12), specItem.ceilingPrice * 0.96),
        );
        break;
      }
    }
  }

  return {
    id: plan.id,
    title: plan.title,
    domain: plan.domain,
    publisher: plan.publisher,
    version_label: "v1.0",
    record_count: plan.record_count,
    release_date: plan.release_date,
    is_sample: plan.is_sample,
    rows,
  };
}

const PLANS: BatchPlan[] = [
  {
    id: "REL-2026-0623-07",
    title: "冠脉支架省平台价格监测批次",
    publisher: "市医保局 · 价格招采处",
    domain: "医用耗材价格治理",
    record_count: 1245867,
    release_date: "2026-06-23",
    is_sample: false,
    total: 42,
    issues: {
      // 一条常规超限（黄色预警档）+ 一条 10 倍以上极端超限（红色预警★★★档，64号分档演示）
      price_over_ceiling: 1,
      price_over_10x: 1,
      collection_over_price: 2,
      hard_code: 1,
      correctable: 2,
      collection_not_landed: 2,
      // 参考价涨幅 15-20% 的中危行：非敏感、可被人审沉淀的规则自动处置（自动复用演示素材）
      price_spike: 2,
      future_date: 1,
      // R6 多渠道比价素材：零售无编码价（名称对应需人审）+ 挂网价超零售集中价 1.3 倍
      retail_no_code: 2,
      retail_over_1p3x: 2,
      // R7 差比价素材：48粒大包装挂网价超 2452号折算上限
      spec_over_ratio: 1,
    },
  },
  {
    id: "REL-2026-0623-08",
    title: "抗菌药挂网价标准化批次",
    publisher: "省医保中心 · 医药价格监测组",
    domain: "药品价格数据标化",
    record_count: 868432,
    release_date: "2026-06-22",
    is_sample: false,
    total: 38,
    issues: { correctable: 6, spec_over_ratio: 2 },
  },
  {
    id: "REL-2026-0623-09",
    title: "集采价格落地跟踪批次",
    publisher: "省医保局 · 集采落地专班",
    domain: "集采价格落地跟踪",
    record_count: 342190,
    release_date: "2026-06-20",
    is_sample: false,
    total: 34,
    // price_below_floor：R8 异常低价演示素材（低价端治理，路云/9号文风险预警两端口径）
    issues: { collection_not_landed: 3, price_spike: 3, correctable: 1, price_below_floor: 1 },
  },
  {
    id: "REL-2026-0623-10",
    title: "国谈药品月度价格巡检批次",
    publisher: "区医保分中心 · 价格治理岗",
    domain: "动态价格监测",
    record_count: 51204,
    release_date: "2026-06-19",
    is_sample: false,
    total: 28,
    issues: {},
  },
  {
    id: "REL-SAMPLE-01",
    title: "样例批次（公开演示 · 可自由编辑）",
    publisher: "市医保局 · 公开演示",
    domain: "医药价格治理",
    record_count: 12458,
    release_date: "2026-06-23",
    is_sample: true,
    total: 14,
    issues: { correctable: 1, price_spike: 1, retail_no_code: 1 },
  },
];

export function buildFixtureReleases(): FixtureRelease[] {
  return PLANS.map(buildBatch);
}
