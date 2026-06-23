// Domain types for 医保可信数据通行 Agent.
// State vocabulary is business-readable zh-CN per PRD section 11.

export type ReleaseState =
  | "待发布"
  | "检查中"
  | "纠错候选"
  | "隔离"
  | "可发布"
  | "需审批"
  | "检查失败";

export type MutationType =
  | "none"
  | "wrong_code"
  | "future_date"
  | "identity_conflict"
  | "access_denied";

export const MUTATIONS: {
  id: MutationType;
  label: string;
  hint: string;
  consequence: string;
}[] = [
  {
    id: "wrong_code",
    label: "错误编码",
    hint: "把病种编码改成不在医保目录字典中的无效编码",
    consequence: "预计进入：纠错候选 / 隔离 —— 编码无法通过目录字典校验。",
  },
  {
    id: "future_date",
    label: "未来日期",
    hint: "把服务日期改到发布日之后",
    consequence: "预计隔离：服务日期晚于发布日，阻断通行。",
  },
  {
    id: "identity_conflict",
    label: "身份冲突",
    hint: "制造 tokenized identity 模糊匹配",
    consequence: "预计需审批：身份匹配不确定，Agent 不自动放行。",
  },
  {
    id: "access_denied",
    label: "权限拒绝",
    hint: "把访问角色/用途改为策略不允许",
    consequence: "预计需审批：访问策略拒绝，需人工审批边界。",
  },
];

export type RunStatus = "success" | "degraded" | "failed";

export type ReplayPhase =
  | "observe"
  | "plan"
  | "tools"
  | "mutate"
  | "verify"
  | "recover";

export interface ReplayEvent {
  phase: ReplayPhase;
  title: string;
  detail: string;
  at: string;
  ok: boolean;
}

export interface ToolCall {
  tool: string;
  label: string;
  input: string;
  output: string;
  ok: boolean;
  finding?: string;
}

export interface AgentPlan {
  issue_focus: string;
  ordered_tools: string[];
  rationale: string;
  expected_state: ReleaseState | string;
  source: "live-provider" | "degraded";
}

export interface DatasetRow {
  id: string;
  release_id: string;
  version_id: string;
  row_index: number;
  person_token: string;
  catalog_code: string;
  service_date: string;
  access_policy: string;
  requester_role: string;
  purpose: string;
}

export interface DatasetRelease {
  id: string;
  title: string;
  domain: string;
  publisher: string;
  version_label: string;
  record_count: number;
  created_at: string;
  release_date: string;
  state: ReleaseState;
  current_run_id: string | null;
  source_manifest_id: string;
  is_sample: number;
  synthetic: number;
}

export interface SourceManifest {
  id: string;
  release_id: string;
  schema_version: string;
  code_dictionary_version: string;
  token_method: string;
  access_policy_version: string;
  release_rule_version: string;
  fixture_provenance: string;
  created_at: string;
}

export interface RowIssue {
  id: string;
  run_id: string;
  release_id: string;
  row_id: string;
  row_index: number;
  type: string;
  severity: string;
  detected_fields: string;
  source_rule: string;
  confidence: number;
  status: string;
  created_at: string;
}

export interface CorrectionProposal {
  id: string;
  run_id: string;
  release_id: string;
  row_id: string;
  issue_id: string;
  field: string;
  before_value: string;
  after_value: string;
  source_dictionary: string;
  rationale: string;
  confidence: number;
  status: string;
  created_at: string;
}

export interface QuarantineItem {
  id: string;
  run_id: string;
  release_id: string;
  row_id: string;
  issue_id: string;
  reason: string;
  impact: string;
  review_status: string;
  created_at: string;
}

export interface ReleaseApproval {
  id: string;
  run_id: string;
  release_id: string;
  row_id: string;
  issue_id: string;
  status: "pending" | "approved" | "rejected";
  reason: string;
  policy_snapshot: string;
  approver: string | null;
  human_notes: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface AgentRun {
  id: string;
  release_id: string;
  mutation_type: MutationType;
  input_summary: string;
  candidate_json: string;
  plan_json: string;
  tools_json: string;
  result_state: ReleaseState;
  before_state: ReleaseState;
  after_state: ReleaseState;
  provider_meta_json: string;
  status: RunStatus;
  error_category: string | null;
  output_hash: string;
  duration_ms: number;
  started_at: string;
  finished_at: string;
}

export interface ReplayTimeline {
  id: string;
  run_id: string;
  release_id: string;
  events_json: string;
  created_at: string;
}

export const STATE_TONE: Record<
  ReleaseState,
  { color: string; soft: string; ink: string }
> = {
  待发布: { color: "amber", soft: "var(--gate-amber-soft)", ink: "var(--gate-amber)" },
  检查中: { color: "blue", soft: "var(--gate-accent-soft)", ink: "var(--gate-accent)" },
  纠错候选: { color: "violet", soft: "#efeaff", ink: "var(--gate-violet)" },
  隔离: { color: "red", soft: "var(--gate-red-soft)", ink: "var(--gate-red)" },
  可发布: { color: "green", soft: "var(--gate-green-soft)", ink: "var(--gate-green)" },
  需审批: { color: "amber", soft: "var(--gate-amber-soft)", ink: "var(--gate-amber)" },
  检查失败: { color: "gray", soft: "#eef1f6", ink: "#5b6675" },
};
