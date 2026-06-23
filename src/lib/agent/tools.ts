import "server-only";
import {
  ACCESS_POLICY,
  CODE_ALIASES,
  CODE_DICTIONARY,
  IDENTITY_REGISTRY,
} from "../fixtures";
import type { ToolCall } from "../types";

export interface CandidateRow {
  person_token: string;
  catalog_code: string;
  service_date: string;
  access_policy: string;
  requester_role: string;
  purpose: string;
}

export interface SchemaFinding {
  ok: boolean;
  missing: string[];
}
export interface DictionaryFinding {
  valid: boolean;
  correctable: boolean;
  suggestion: string | null;
  name: string | null;
}
export interface IdentityFinding {
  matched: boolean;
  ambiguous: boolean;
  candidates: number;
}
export interface PolicyFinding {
  allowed: boolean;
  reason: string;
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

export function schemaMapper(row: CandidateRow): {
  finding: SchemaFinding;
  call: ToolCall;
} {
  const required = [
    "person_token",
    "catalog_code",
    "service_date",
    "access_policy",
  ] as const;
  const missing = required.filter((f) => !String(row[f] ?? "").trim());
  const ok = missing.length === 0;
  return {
    finding: { ok, missing },
    call: tc(
      "schema_mapper",
      "schema 映射",
      `fields=${required.join(",")}`,
      ok ? "schema 字段完整 → ok" : `缺失字段 ${missing.join(",")} → issue`,
      ok,
      ok ? undefined : "schema_field_missing",
    ),
  };
}

export function codeDictionaryValidator(row: CandidateRow): {
  finding: DictionaryFinding;
  call: ToolCall;
} {
  const code = row.catalog_code.trim();
  const valid = Object.prototype.hasOwnProperty.call(CODE_DICTIONARY, code);
  const suggestion = !valid ? CODE_ALIASES[code] ?? null : null;
  const correctable = Boolean(suggestion);
  const name = valid
    ? CODE_DICTIONARY[code]
    : suggestion
      ? CODE_DICTIONARY[suggestion]
      : null;
  let output: string;
  if (valid) output = `命中目录字典：${code} = ${name} → ok`;
  else if (correctable)
    output = `未命中字典，存在高置信纠错别名 ${code} → ${suggestion} → correctable`;
  else output = `未命中目录字典且无安全纠错别名：${code} → fail`;
  return {
    finding: { valid, correctable, suggestion, name },
    call: tc(
      "code_dictionary_validator",
      "目录字典校验",
      `catalog_code=${code}`,
      output,
      valid,
      valid ? undefined : correctable ? "code_correctable" : "code_dictionary_miss",
    ),
  };
}

export function tokenizedIdentityMatcher(row: CandidateRow): {
  finding: IdentityFinding;
  call: ToolCall;
} {
  const token = row.person_token.trim();
  const exact = IDENTITY_REGISTRY.includes(token);
  // 模糊匹配：相同的脱敏前缀（前 6 位 + 掩码）但尾号不一致 → 多候选。
  const prefix = token.slice(0, 6);
  const samePrefix = IDENTITY_REGISTRY.filter((t) => t.slice(0, 6) === prefix);
  const ambiguous = !exact && samePrefix.length >= 1;
  const candidates = exact ? 1 : samePrefix.length;
  let output: string;
  if (exact) output = `唯一命中身份注册表 → ok`;
  else if (ambiguous)
    output = `未唯一命中，前缀 ${prefix} 存在 ${candidates} 个候选 → 模糊匹配`;
  else output = `未命中身份注册表 → 无法匹配`;
  return {
    finding: { matched: exact, ambiguous, candidates },
    call: tc(
      "tokenized_identity_matcher",
      "身份 token 匹配",
      `person_token=${token}`,
      output,
      exact,
      exact ? undefined : ambiguous ? "identity_ambiguous" : "identity_unmatched",
    ),
  };
}

export function accessPolicyEvaluator(row: CandidateRow): {
  finding: PolicyFinding;
  call: ToolCall;
} {
  const policy = ACCESS_POLICY[row.access_policy];
  if (!policy) {
    return {
      finding: { allowed: false, reason: `未知访问策略 ${row.access_policy}` },
      call: tc(
        "access_policy_evaluator",
        "访问策略评估",
        `policy=${row.access_policy}`,
        `策略快照缺失 → 需审批`,
        false,
        "policy_missing",
      ),
    };
  }
  const roleOk = policy.allowedRoles.includes(row.requester_role);
  const purposeOk = policy.allowedPurposes.includes(row.purpose);
  const allowed = roleOk && purposeOk;
  const reason = allowed
    ? "角色与用途均满足访问策略"
    : `${!roleOk ? `角色「${row.requester_role}」不在允许列表` : ""}${
        !roleOk && !purposeOk ? "；" : ""
      }${!purposeOk ? `用途「${row.purpose}」不被允许` : ""}`;
  return {
    finding: { allowed, reason },
    call: tc(
      "access_policy_evaluator",
      "访问策略评估",
      `role=${row.requester_role}, purpose=${row.purpose}`,
      allowed ? "角色/用途满足策略 → ok" : `${reason} → 越权`,
      allowed,
      allowed ? undefined : "access_policy_denied",
    ),
  };
}

export function anomalyProfiler(
  row: CandidateRow,
  releaseDate: string,
): { finding: AnomalyFinding; call: ToolCall } {
  const svc = Date.parse(row.service_date);
  const rel = Date.parse(releaseDate);
  let anomaly = false;
  let kind: string | null = null;
  let detail = "日期在合理范围内";
  if (Number.isNaN(svc)) {
    anomaly = true;
    kind = "date_unparseable";
    detail = `服务日期无法解析：${row.service_date}`;
  } else if (!Number.isNaN(rel) && svc > rel) {
    anomaly = true;
    kind = "future_service_date";
    detail = `服务日期 ${row.service_date} 晚于发布日 ${releaseDate}`;
  }
  return {
    finding: { anomaly, kind, detail },
    call: tc(
      "anomaly_profiler",
      "异常画像",
      `service_date=${row.service_date}, release_date=${releaseDate}`,
      anomaly ? `${detail} → 异常` : "未发现日期异常 → ok",
      !anomaly,
      anomaly ? "date_anomaly" : undefined,
    ),
  };
}

export const TOOL_LABELS: Record<string, string> = {
  schema_mapper: "schema 映射",
  code_dictionary_validator: "目录字典校验",
  tokenized_identity_matcher: "身份 token 匹配",
  access_policy_evaluator: "访问策略评估",
  anomaly_profiler: "异常画像",
  correction_writer: "纠错提案写入",
  quarantine_writer: "隔离项写入",
  approval_router: "审批路由",
  replay_builder: "回放组装",
};
