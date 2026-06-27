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
    landedRegions: ["上海市", "江苏省", "浙江省", "安徽省"],
  },
  "YP-AMT-002": {
    name: "阿托伐他汀钙片 20mg*14片",
    category: "药品",
    unit: "盒",
    referencePrice: 18.9,
    ceilingPrice: 28,
    collectivePrice: 13.86,
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
  | "price_spike"
  | "collection_not_landed"
  | "collection_over_price"
  | "schema_missing";

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
  const nextIndex = (): number => {
    let idx = Math.floor(rng() * plan.total);
    let guard = 0;
    while (taken.has(idx) && guard < plan.total * 3) {
      idx = (idx + 1) % plan.total;
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
      case "price_spike":
        r.procurement_channel = "省级挂网";
        r.unit_price = money(item.referencePrice * (1.16 + rng() * 0.08));
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
      price_over_ceiling: 2,
      collection_over_price: 2,
      hard_code: 1,
      correctable: 2,
      collection_not_landed: 2,
      future_date: 1,
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
    issues: { correctable: 6 },
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
    issues: { collection_not_landed: 3, price_spike: 3, correctable: 1 },
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
    issues: { correctable: 1, price_spike: 1 },
  },
];

export function buildFixtureReleases(): FixtureRelease[] {
  return PLANS.map(buildBatch);
}
