// Synthetic / desensitized 医保 fixtures (PRD 12.1: no raw sensitive data).
// Everything here is fabricated sample content with a source manifest so the
// release gate can run end-to-end without touching real protected data.

export const SCHEMA_VERSION = "schema-v1.0";
export const CODE_DICTIONARY_VERSION = "catalog-dict-v2.4.1";
export const TOKEN_METHOD = "HMAC-SHA256 masked token (脱敏)";
export const ACCESS_POLICY_VERSION = "access-policy-v2.4";
export const RELEASE_RULE_VERSION = "release-rule-v2.4.1";

export const SCHEMA_FIELDS = [
  { field: "person_token", label: "人员标识", type: "tokenized_id" },
  { field: "catalog_code", label: "病种编码", type: "medical_catalog_code" },
  { field: "service_date", label: "服务日期", type: "date" },
  { field: "access_policy", label: "访问策略", type: "policy_label" },
];

// 病种 / 医保目录编码字典（脱敏示例，使用 ICD-10 形态编码）。
export const CODE_DICTIONARY: Record<string, string> = {
  "J18.9": "肺炎，未特指病原体",
  "E11.9": "2型糖尿病，不伴并发症",
  I10: "特发性（原发性）高血压",
  "K80.2": "胆囊结石，不伴胆囊炎",
  "M54.5": "下背痛",
  "N39.0": "尿路感染，部位未特指",
  "J45.9": "哮喘，未特指",
  "K29.7": "胃炎，未特指",
  "I25.1": "动脉粥样硬化性心脏病",
  "E78.5": "高脂血症，未特指",
};

// 高置信纠错别名：常见录入错误 -> 规范编码。
export const CODE_ALIASES: Record<string, string> = {
  I1O: "I10", // 字母 O 误作 0
  IIO: "I10",
  "J18.90": "J18.9",
  E119: "E11.9",
  "K80.20": "K80.2",
  "N390": "N39.0",
};

// 访问策略：每个策略标签允许的角色与用途。
export const ACCESS_POLICY: Record<
  string,
  { allowedRoles: string[]; allowedPurposes: string[] }
> = {
  "医保内部-诊疗明细-只读": {
    allowedRoles: ["数据运营员", "基金监管分析员", "目录维护员", "数据安全员"],
    allowedPurposes: ["内部分析", "基金监管", "质量校验", "目录维护"],
  },
};

export const DENIED_ROLE_HINT = ["外部分析员", "第三方机构", "商业合作方"];
export const DENIED_PURPOSE_HINT = ["对外共享", "商业用途", "出域分析"];

// 受信任的脱敏身份 token 注册表（同一前缀+尾号唯一）。
export const IDENTITY_REGISTRY: string[] = [
  "110101*******1234",
  "310104*******5678",
  "330203*******9012",
  "440300*******3456",
  "510106*******7890",
  "210102*******2468",
];

export const RELEASE_RULES = [
  "R1 服务日期不得晚于发布日（防止未来日期污染时序分析）。",
  "R2 病种编码必须命中医保目录字典当前版本。",
  "R3 人员标识必须唯一命中脱敏身份注册表，模糊匹配需人工审批。",
  "R4 访问角色与用途必须满足该批次访问策略，越权需人工审批。",
];

export interface FixtureRow {
  person_token: string;
  catalog_code: string;
  service_date: string;
  access_policy: string;
  requester_role: string;
  purpose: string;
}

const POLICY = "医保内部-诊疗明细-只读";
const ROLE = "数据运营员";
const PURPOSE = "内部分析";

export interface FixtureRelease {
  id: string;
  title: string;
  domain: string;
  publisher: string;
  version_label: string;
  record_count: number;
  release_date: string;
  is_sample: boolean;
  highlight_index: number;
  rows: FixtureRow[];
}

function row(
  person_token: string,
  catalog_code: string,
  service_date: string,
): FixtureRow {
  return {
    person_token,
    catalog_code,
    service_date,
    access_policy: POLICY,
    requester_role: ROLE,
    purpose: PURPOSE,
  };
}

export function buildFixtureReleases(): FixtureRelease[] {
  return [
    {
      id: "REL-2026-0623-07",
      title: "医疗服务诊疗明细批次",
      domain: "医疗服务",
      publisher: "市医保中心",
      version_label: "v1.0",
      record_count: 1245867,
      release_date: "2026-06-23",
      is_sample: false,
      highlight_index: 2,
      rows: [
        row("110101*******1234", "J18.9", "2026-06-18"),
        row("310104*******5678", "E11.9", "2026-06-19"),
        row("330203*******9012", "I10", "2026-06-20"),
        row("440300*******3456", "K80.2", "2026-06-21"),
        row("510106*******7890", "M54.5", "2026-06-17"),
        row("210102*******2468", "N39.0", "2026-06-22"),
      ],
    },
    {
      id: "REL-SAMPLE-01",
      title: "样例 Release（公开演示）",
      domain: "医疗服务",
      publisher: "市医保中心",
      version_label: "v1.0",
      record_count: 12458,
      release_date: "2026-06-23",
      is_sample: true,
      highlight_index: 2,
      rows: [
        row("110101*******1234", "J45.9", "2026-06-18"),
        row("310104*******5678", "K29.7", "2026-06-19"),
        row("330203*******9012", "I10", "2026-06-20"),
        row("440300*******3456", "I25.1", "2026-06-21"),
        row("510106*******7890", "E78.5", "2026-06-17"),
        row("210102*******2468", "N39.0", "2026-06-22"),
      ],
    },
  ];
}
