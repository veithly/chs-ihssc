import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Durable storage for dataset releases, issues, corrections, quarantine,
// approvals, agent runs, and replay timelines (PRD 6.2 / 12.1).
// Uses Node's built-in synchronous SQLite (node:sqlite) — a real on-disk
// database file at data/release-gate.db, no native build required.

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = join(DATA_DIR, "release-gate.db");

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
  person_token TEXT NOT NULL,
  catalog_code TEXT NOT NULL,
  service_date TEXT NOT NULL,
  access_policy TEXT NOT NULL,
  requester_role TEXT NOT NULL,
  purpose TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_manifest (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  code_dictionary_version TEXT NOT NULL,
  token_method TEXT NOT NULL,
  access_policy_version TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_row_release ON dataset_row(release_id);
CREATE INDEX IF NOT EXISTS idx_issue_run ON row_issue(run_id);
CREATE INDEX IF NOT EXISTS idx_run_release ON agent_run(release_id);
CREATE INDEX IF NOT EXISTS idx_replay_run ON replay_timeline(run_id);
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
