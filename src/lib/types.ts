// Domain types for the 价序 price-governance workspace.
// State vocabulary is business-readable zh-CN for price governance operators.

export type ReleaseState =
  | "待治理"
  | "监测中"
  | "纠错候选"
  | "异常处置"
  | "可落地"
  | "需核验"
  | "检查失败";

// A run is a whole-batch scan. The legacy single-row mutation vocabulary is
// gone: dirty data lives naturally in the batch and the operator edits real
// rows. `scan_kind` is persisted in the agent_run.mutation_type column.
export type ScanKind = "batch_scan" | "imported_batch";

// Fields an operator can freely edit inline before re-running the gate.
export const EDITABLE_FIELDS = [
  "item_code",
  "item_name",
  "price_date",
  "procurement_channel",
  "region",
  "unit_price",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export type RunStatus = "success" | "degraded" | "failed";

// Per-row verdict produced by the deterministic tools (server-side).
export interface RowVerdict {
  state: ReleaseState; // 可落地 / 纠错候选 / 异常处置 / 需核验
  issueType: string; // "" when clean
  severity: "low" | "medium" | "high";
  sourceRule: string;
  confidence: number;
  detectedFields: string[];
  writer: "correction" | "quarantine" | "approval" | null;
  issueText: string;
  recommendation: string;
  suggestion?: string | null; // correction target value
}

// Aggregate statistics for a whole-batch scan (persisted in candidate_json).
export interface BatchStats {
  total_rows: number;
  scanned: number;
  validations: number; // scanned * validator count
  clean: number;
  issues: number;
  by_state: Record<"可落地" | "纠错候选" | "异常处置" | "需核验", number>;
  by_issue_type: Record<string, number>;
  affected_row_indexes: number[];
  validators: number;
}

export type ReplayPhase =
  | "observe"
  | "plan"
  | "tools"
  | "mutate"
  | "verify"
  | "recover"
  | "learn";

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
  item_code: string;
  item_name: string;
  price_date: string;
  procurement_channel: string;
  region: string;
  unit_price: string;
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
  procurement_channel_version: string;
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
  mutation_type: string; // scan kind (batch_scan / imported_batch)
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

export type MorningSessionStatus =
  | "not_started"
  | "opening"
  | "planned"
  | "handling"
  | "closing"
  | "closed"
  | "partial_failed"
  | "failed";

export type DailyLeadStatus =
  | "machine_found"
  | "today_todo"
  | "pending_evidence"
  | "pending_verification"
  | "pending_disposal"
  | "pending_follow_up"
  | "observing"
  | "excluded"
  | "closed"
  | "rolled_over"
  | "check_failed";

export type DailyLeadAction =
  | "request_evidence"
  | "route_verification"
  | "move_disposal"
  | "observe"
  | "exclude"
  | "record_response";

export interface MorningSession {
  id: string;
  session_date: string;
  org_scope: string;
  opened_by: string;
  source_cutoff_at: string;
  priority_input_json: string;
  plan_version: number;
  status: MorningSessionStatus;
  lead_count: number;
  status_summary_json: string;
  daybook_summary_json: string;
  agent_run_id: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyLead {
  id: string;
  session_id: string;
  lead_type: string;
  source_ref_type: string;
  source_ref_id: string;
  institution_id: string | null;
  institution_name_masked: string;
  region_code: string | null;
  item_code: string;
  item_name: string;
  spec: string | null;
  package_unit: string | null;
  baseline_price: number | null;
  execution_price: number | null;
  delta_pct: number | null;
  priority_score: number;
  priority_reasons_json: string;
  evidence_gap_json: string;
  evidence_json: string;
  next_action: string;
  owner_role: string;
  owner_id: string | null;
  due_at: string | null;
  status: DailyLeadStatus;
  human_confirmation_required: number;
  created_at: string;
  updated_at: string;
}

export interface WatchlistItem {
  id: string;
  watch_type: string;
  subject_id: string | null;
  subject_name_masked: string;
  reason: string;
  weight: number;
  effective_from: string | null;
  effective_to: string | null;
  owner_role: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FollowUpTask {
  id: string;
  lead_id: string;
  session_id: string | null;
  task_type: string;
  assignee_type: string;
  assignee_id: string | null;
  evidence_required_json: string;
  message_draft: string;
  due_at: string | null;
  status: string;
  response_json: string;
  last_contact_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type WorkspaceThreadState =
  | "idle"
  | "has_context"
  | "planning"
  | "running"
  | "needs_user"
  | "ready"
  | "failed"
  | "draft_unavailable";

export type WorkspaceMessageRole = "user" | "assistant" | "system";

export interface ConversationThread {
  id: string;
  title: string;
  state: WorkspaceThreadState;
  context_type: string;
  context_ref_id: string | null;
  source_label: string | null;
  last_instruction: string | null;
  provider_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  thread_id: string;
  role: WorkspaceMessageRole;
  content: string;
  meta_json: string;
  created_at: string;
}

export interface UploadedDataset {
  id: string;
  thread_id: string | null;
  title: string;
  file_name: string | null;
  source_type: string;
  row_count: number;
  columns_json: string;
  rows_json: string;
  release_id: string | null;
  synthetic: number;
  created_at: string;
}

export interface DataSourceConnection {
  id: string;
  thread_id: string | null;
  label: string;
  source_kind: string;
  status: string;
  dataset_id: string | null;
  row_count: number;
  metadata_json: string;
  connected_at: string;
}

export interface AgentInstruction {
  id: string;
  thread_id: string;
  run_id: string;
  prompt_key: string | null;
  instruction: string;
  instruction_type: string;
  created_at: string;
}

export interface FieldMapping {
  id: string;
  thread_id: string;
  run_id: string;
  dataset_id: string;
  source_column: string;
  target_field: string;
  confidence: number;
  status: string;
  reason: string;
  created_at: string;
}

export interface RepairPatch {
  id: string;
  thread_id: string;
  run_id: string;
  dataset_id: string;
  row_index: number;
  field: string;
  before_value: string;
  after_value: string;
  status: string;
  reason: string;
  confidence: number;
  created_at: string;
}

export interface MatchGroup {
  id: string;
  thread_id: string;
  run_id: string;
  dataset_id: string;
  group_key: string;
  item_name: string;
  row_indexes_json: string;
  status: string;
  reason_json: string;
  created_at: string;
}

export interface UnitConversion {
  id: string;
  thread_id: string;
  run_id: string;
  group_id: string;
  source_unit: string;
  target_unit: string;
  formula: string;
  converted_count: number;
  status: string;
  created_at: string;
}

export interface PriceBasisPack {
  id: string;
  thread_id: string;
  run_id: string;
  group_id: string;
  basis_json: string;
  created_at: string;
}

export interface RuleEvaluation {
  id: string;
  thread_id: string;
  run_id: string;
  group_id: string;
  result: string;
  reason_code: string;
  detail: string;
  created_at: string;
}

export interface DispositionItem {
  id: string;
  thread_id: string;
  run_id: string;
  group_id: string | null;
  row_index: number;
  item_name: string;
  institution_name: string;
  issue_type: string;
  severity: string;
  status: string;
  next_action: string;
  created_at: string;
  updated_at: string;
}

export interface InstitutionDraft {
  id: string;
  thread_id: string;
  run_id: string;
  disposition_id: string | null;
  target_name: string;
  draft_type: string;
  content: string;
  status: string;
  provider_meta_json: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowTask {
  id: string;
  thread_id: string;
  run_id: string;
  disposition_id: string | null;
  drift_id?: string | null;
  task_type: string;
  owner_role: string;
  status: string;
  priority: string;
  due_at: string | null;
  title: string;
  detail: string;
  final_action?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunEvent {
  id: string;
  thread_id: string;
  run_id: string;
  phase: ReplayPhase;
  title: string;
  detail: string;
  ok: number;
  event_json: string;
  created_at: string;
}

export interface WorkspaceSnapshot {
  thread: ConversationThread | null;
  dataset: UploadedDataset | null;
  connection: DataSourceConnection | null;
  messages: ConversationMessage[];
  instructions: AgentInstruction[];
  fieldMappings: FieldMapping[];
  repairPatches: RepairPatch[];
  matchGroups: MatchGroup[];
  unitConversions: UnitConversion[];
  priceBasisPacks: PriceBasisPack[];
  ruleEvaluations: RuleEvaluation[];
  dispositionItems: DispositionItem[];
  institutionDrafts: InstitutionDraft[];
  workflowTasks: WorkflowTask[];
  runEvents: RunEvent[];
  recentThreads: ConversationThread[];
}

export const STATE_TONE: Record<
  ReleaseState,
  { color: string; soft: string; ink: string }
> = {
  待治理: { color: "amber", soft: "var(--gate-amber-soft)", ink: "var(--gate-amber)" },
  监测中: { color: "blue", soft: "var(--gate-accent-soft)", ink: "var(--gate-accent)" },
  纠错候选: { color: "violet", soft: "#efeaff", ink: "var(--gate-violet)" },
  异常处置: { color: "red", soft: "var(--gate-red-soft)", ink: "var(--gate-red)" },
  可落地: { color: "green", soft: "var(--gate-green-soft)", ink: "var(--gate-green)" },
  需核验: { color: "amber", soft: "var(--gate-amber-soft)", ink: "var(--gate-amber)" },
  检查失败: { color: "gray", soft: "#eef1f6", ink: "#5b6675" },
};
