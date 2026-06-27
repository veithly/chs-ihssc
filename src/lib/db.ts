import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Durable storage for price batches, issues, corrections, disposal items,
// verification tasks, agent runs, and replay timelines.
// Uses Node's built-in synchronous SQLite (node:sqlite) — a real on-disk
// database file at data/price-governance.db, no native build required.

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "price-governance.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dataset_release (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  publisher TEXT NOT NULL,
  version_label TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  release_date TEXT NOT NULL,
  state TEXT NOT NULL,
  current_run_id TEXT,
  source_manifest_id TEXT NOT NULL,
  is_sample INTEGER NOT NULL DEFAULT 0,
  synthetic INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dataset_version (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  version_label TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_row (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  price_date TEXT NOT NULL,
  procurement_channel TEXT NOT NULL,
  region TEXT NOT NULL,
  unit_price TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_manifest (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  code_dictionary_version TEXT NOT NULL,
  token_method TEXT NOT NULL,
  procurement_channel_version TEXT NOT NULL,
  release_rule_version TEXT NOT NULL,
  fixture_provenance TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_rule_snapshot (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS row_issue (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  detected_fields TEXT NOT NULL,
  source_rule TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correction_proposal (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  field TEXT NOT NULL,
  before_value TEXT NOT NULL,
  after_value TEXT NOT NULL,
  source_dictionary TEXT NOT NULL,
  rationale TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quarantine_item (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  impact TEXT NOT NULL,
  review_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_approval (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  policy_snapshot TEXT NOT NULL,
  approver TEXT,
  human_notes TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  mutation_type TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  candidate_json TEXT NOT NULL DEFAULT '{}',
  plan_json TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  result_state TEXT NOT NULL,
  before_state TEXT NOT NULL,
  after_state TEXT NOT NULL,
  provider_meta_json TEXT NOT NULL,
  status TEXT NOT NULL,
  error_category TEXT,
  output_hash TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS replay_timeline (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  events_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS morning_session (
  id TEXT PRIMARY KEY,
  session_date TEXT NOT NULL,
  org_scope TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  source_cutoff_at TEXT NOT NULL,
  priority_input_json TEXT NOT NULL,
  plan_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  lead_count INTEGER NOT NULL DEFAULT 0,
  status_summary_json TEXT NOT NULL DEFAULT '{}',
  daybook_summary_json TEXT NOT NULL DEFAULT '{}',
  agent_run_id TEXT,
  opened_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_lead (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lead_type TEXT NOT NULL,
  source_ref_type TEXT NOT NULL,
  source_ref_id TEXT NOT NULL,
  institution_id TEXT,
  institution_name_masked TEXT NOT NULL,
  region_code TEXT,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  spec TEXT,
  package_unit TEXT,
  baseline_price REAL,
  execution_price REAL,
  delta_pct REAL,
  priority_score REAL NOT NULL,
  priority_reasons_json TEXT NOT NULL,
  evidence_gap_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  next_action TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  owner_id TEXT,
  due_at TEXT,
  status TEXT NOT NULL,
  human_confirmation_required INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  id TEXT PRIMARY KEY,
  watch_type TEXT NOT NULL,
  subject_id TEXT,
  subject_name_masked TEXT NOT NULL,
  reason TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  effective_from TEXT,
  effective_to TEXT,
  owner_role TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follow_up_task (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  session_id TEXT,
  task_type TEXT NOT NULL,
  assignee_type TEXT NOT NULL,
  assignee_id TEXT,
  evidence_required_json TEXT NOT NULL,
  message_draft TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL,
  response_json TEXT NOT NULL DEFAULT '{}',
  last_contact_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_thread (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  context_type TEXT NOT NULL,
  context_ref_id TEXT,
  source_label TEXT,
  last_instruction TEXT,
  provider_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploaded_dataset (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  title TEXT NOT NULL,
  file_name TEXT,
  source_type TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  columns_json TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  release_id TEXT,
  synthetic INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_source_connection (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  label TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  dataset_id TEXT,
  row_count INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  connected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_instruction (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  prompt_key TEXT,
  instruction TEXT NOT NULL,
  instruction_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_mapping (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  source_column TEXT NOT NULL,
  target_field TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repair_patch (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  field TEXT NOT NULL,
  before_value TEXT NOT NULL,
  after_value TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_group (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  row_indexes_json TEXT NOT NULL,
  status TEXT NOT NULL,
  reason_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS unit_conversion (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  source_unit TEXT NOT NULL,
  target_unit TEXT NOT NULL,
  formula TEXT NOT NULL,
  converted_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_basis_pack (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  basis_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_evaluation (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  result TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disposition_item (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  group_id TEXT,
  row_index INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  next_action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS institution_draft (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  disposition_id TEXT,
  target_name TEXT NOT NULL,
  draft_type TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_meta_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_task (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  disposition_id TEXT,
  task_type TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  due_at TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_event (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  ok INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_row_release ON dataset_row(release_id);
CREATE INDEX IF NOT EXISTS idx_issue_run ON row_issue(run_id);
CREATE INDEX IF NOT EXISTS idx_run_release ON agent_run(release_id);
CREATE INDEX IF NOT EXISTS idx_replay_run ON replay_timeline(run_id);
CREATE INDEX IF NOT EXISTS idx_morning_date ON morning_session(session_date);
CREATE INDEX IF NOT EXISTS idx_lead_session ON daily_lead(session_id);
CREATE INDEX IF NOT EXISTS idx_lead_status ON daily_lead(status);
CREATE INDEX IF NOT EXISTS idx_follow_lead ON follow_up_task(lead_id);
CREATE INDEX IF NOT EXISTS idx_workspace_thread_updated ON conversation_thread(updated_at);
CREATE INDEX IF NOT EXISTS idx_workspace_message_thread ON conversation_message(thread_id);
CREATE INDEX IF NOT EXISTS idx_workspace_dataset_thread ON uploaded_dataset(thread_id);
CREATE INDEX IF NOT EXISTS idx_workspace_instruction_thread ON agent_instruction(thread_id);
CREATE INDEX IF NOT EXISTS idx_workspace_field_run ON field_mapping(run_id);
CREATE INDEX IF NOT EXISTS idx_workspace_repair_run ON repair_patch(run_id);
CREATE INDEX IF NOT EXISTS idx_workspace_group_run ON match_group(run_id);
CREATE INDEX IF NOT EXISTS idx_workspace_disposition_thread ON disposition_item(thread_id);
CREATE INDEX IF NOT EXISTS idx_workspace_workflow_thread ON workflow_task(thread_id);
CREATE INDEX IF NOT EXISTS idx_workspace_event_run ON run_event(run_id);
`;

type GlobalDb = typeof globalThis & { __releaseGateDb?: DatabaseSync };

function open(): DatabaseSync {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export function getDb(): DatabaseSync {
  const g = globalThis as GlobalDb;
  if (!g.__releaseGateDb) {
    g.__releaseGateDb = open();
  }
  return g.__releaseGateDb;
}

export { DB_PATH };
