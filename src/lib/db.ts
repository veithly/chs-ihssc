import "server-only";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Durable storage for price batches, issues, corrections, disposal items,
// verification tasks, agent runs, and replay timelines.
// Uses Node's built-in synchronous SQLite (node:sqlite) in Node/Edge runtime,
// and falls back to an in-memory store in Cloudflare Workers.

type RowRecord = Record<string, unknown>;

type StatementLike = {
  all(params?: Record<string, unknown> | readonly unknown[]): RowRecord[];
  get(params?: Record<string, unknown> | readonly unknown[]): RowRecord | null;
  run(params?: Record<string, unknown> | readonly unknown[]): { rowsAffected: number; changes: number };
};

type DatabaseLike = {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
};

type GlobalDb = typeof globalThis & { __releaseGateDb?: DatabaseLike };

let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  const mod = require("node:sqlite");
  DatabaseSync = mod.DatabaseSync;
} catch {
  DatabaseSync = null;
}

const isWorkers = typeof globalThis !== "undefined" && "ASSETS" in globalThis;

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

-- ===== V2: 政策实时对齐 + 自学习规则引擎 =====

-- 政策/数据源注册表（分级 L0-L3 + 合规准入）
CREATE TABLE IF NOT EXISTS policy_source (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  base_url TEXT,
  access_level TEXT NOT NULL,
  crawl_strategy TEXT NOT NULL,
  robots_status TEXT,
  terms_status TEXT,
  rate_limit_per_min INTEGER DEFAULT 6,
  enabled INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 原始抓取/导入任务留痕
CREATE TABLE IF NOT EXISTS ingestion_run (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  fetched_count INTEGER DEFAULT 0,
  changed_count INTEGER DEFAULT 0,
  parser_version TEXT,
  error_json TEXT,
  actor TEXT
);

-- 规范化政策事实（从 PRICE_CATALOG 外部化而来；漂移检测的 baseline）
CREATE TABLE IF NOT EXISTS policy_fact (
  id TEXT PRIMARY KEY,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  category TEXT,
  unit TEXT,
  reference_price REAL,
  ceiling_price REAL,
  collective_price REAL,
  landed_regions_json TEXT,
  effective_start TEXT NOT NULL,
  effective_end TEXT,
  jurisdiction TEXT NOT NULL,
  source_url TEXT,
  source_hash TEXT,
  confidentiality_level TEXT NOT NULL DEFAULT 'public',
  fact_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_fact_code ON policy_fact(item_code);

-- 原始政策公告 artifact（抓取产物；独立于 policy_fact，人审确认后才生成事实）
CREATE TABLE IF NOT EXISTS policy_artifact (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT,
  content_hash TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  parser_version TEXT,
  status TEXT NOT NULL DEFAULT 'fetched',
  raw_meta_json TEXT,
  ingestion_run_id TEXT,
  reviewer TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_id, url, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_policy_artifact_status ON policy_artifact(status);

-- 政策漂移检测日志
CREATE TABLE IF NOT EXISTS policy_drift_log (
  id TEXT PRIMARY KEY,
  detected_at TEXT NOT NULL,
  item_code TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  baseline_json TEXT NOT NULL,
  observed_json TEXT NOT NULL,
  drift_type TEXT NOT NULL,
  drift_score REAL NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'detected',
  thread_id TEXT,
  run_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drift_status ON policy_drift_log(status);

-- 自学习规则候选（人审激活后下批自动复用）
CREATE TABLE IF NOT EXISTS rule_candidate (
  id TEXT PRIMARY KEY,
  trigger_json TEXT NOT NULL,
  proposed_action_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  support_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_review',
  source_feedback_ids_json TEXT,
  source_decision_ids_json TEXT,
  provenance_run_id TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  reviewer TEXT,
  review_notes TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rule_candidate_status ON rule_candidate(status);

-- 不可变审批决策日志（自动+人审全留痕；规则挖掘的数据源）
CREATE TABLE IF NOT EXISTS approval_decision_log (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  run_id TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  rule_candidate_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_log_target ON approval_decision_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_decision_log_context ON approval_decision_log(context_hash);
`;

interface InMemoryDatabase {
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  select(table: string, where?: { column: string; value: unknown }, orderBy?: { column: string; direction: "ASC" | "DESC" }, limit?: number): RowRecord[];
  count(table: string, where?: { column: string; value: unknown }): number;
  insert(table: string, row: RowRecord): void;
}

function createInMemoryStatement(db: InMemoryDatabase, sql: string): StatementLike {
  return {
    all(params?: Record<string, unknown> | readonly unknown[]): RowRecord[] {
      const upper = sql.trim().toUpperCase();

      if (upper.startsWith("SELECT COUNT(")) {
        const countMatch = sql.match(/COUNT\(\*\)\s+AS\s+(\w+)/i);
        const tableMatch = sql.match(/FROM\s+(\w+)/i);
        if (tableMatch) {
          const count = db.count(tableMatch[1]);
          const alias = countMatch?.[1] ?? "COUNT(*)";
          return [{ [alias]: count }];
        }
      }

      if (upper.startsWith("SELECT * FROM")) {
        const match = sql.match(/FROM\s+(\w+)/i);
        if (match) {
          const table = match[1];
          let rows = db.select(table);

          const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*:(\w+)/i);
          if (whereMatch) {
            const paramName = whereMatch[2];
            const paramValue =
              !Array.isArray(params) && typeof params === "object" && params !== null
                ? (params as Record<string, unknown>)[paramName]
                : undefined;
            rows = rows.filter((r) => r[whereMatch[1]] === paramValue);
          }

          const orderMatch = sql.match(/ORDER BY\s+(\w+)\s+(ASC|DESC)/i);
          if (orderMatch) {
            const direction = orderMatch[2] as "ASC" | "DESC";
            rows.sort((a, b) => {
              const aVal = a[orderMatch[1]];
              const bVal = b[orderMatch[1]];
              if (aVal === bVal) return 0;
              if (aVal == null) return 1;
              if (bVal == null) return -1;
              const cmp = String(aVal).localeCompare(String(bVal));
              return direction === "DESC" ? -cmp : cmp;
            });
          }

          const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
          if (limitMatch) {
            rows = rows.slice(0, parseInt(limitMatch[1], 10));
          }

          return rows;
        }
      }

      return [];
    },

    get(params?: Record<string, unknown> | readonly unknown[]): RowRecord | null {
      const rows = this.all(params);
      return rows[0] ?? null;
    },

    run(params?: Record<string, unknown> | readonly unknown[]): { rowsAffected: number; changes: number } {
      const insertMatch = sql.match(
        /INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
      );
      if (insertMatch) {
        const table = insertMatch[1];
        const columns = insertMatch[2].split(",").map((c) => c.trim());
        const values = insertMatch[3].split(",").map((v) => {
          const trimmed = v.trim();
          if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
            return trimmed.slice(1, -1);
          }
          if (trimmed.toUpperCase() === "NULL") return null;
          if (trimmed.toUpperCase() === "TRUE") return true;
          if (trimmed.toUpperCase() === "FALSE") return false;
          if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
          if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
          return trimmed;
        });

        const row: RowRecord = {};
        columns.forEach((col, idx) => {
          row[col] = values[idx];
        });

        if (params) {
          for (const [key, value] of Object.entries(params)) {
            if (key in row) {
              row[key] = value;
            }
          }
        }

        db.insert(table, row);
        return { rowsAffected: 1, changes: 1 };
      }

      return { rowsAffected: 0, changes: 0 };
    },
  };
}

function createInMemoryDatabase(): InMemoryDatabase {
  const tables: Record<string, RowRecord[]> = {};
  let nextId = 1;

  return {
    exec(sql: string): void {
      const normalized = sql.trim();
      if (!normalized.toUpperCase().startsWith("CREATE TABLE")) return;

      const createTableRegex = /CREATE TABLE IF NOT EXISTS (\w+)/gi;
      let match: RegExpExecArray | null;
      while ((match = createTableRegex.exec(normalized)) !== null) {
        const tableName = match[1];
        if (!tables[tableName]) {
          tables[tableName] = [];
        }
      }
    },

    prepare(sql: string): StatementLike {
      return createInMemoryStatement(this, sql);
    },

    select(
      table: string,
      where?: { column: string; value: unknown },
      orderBy?: { column: string; direction: "ASC" | "DESC" },
      limit?: number,
    ): RowRecord[] {
      let rows = tables[table] ? [...tables[table]] : [];
      if (where) {
        rows = rows.filter((r) => r[where.column] === where.value);
      }
      if (orderBy) {
        rows.sort((a, b) => {
          const aVal = a[orderBy.column];
          const bVal = b[orderBy.column];
          if (aVal === bVal) return 0;
          if (aVal == null) return 1;
          if (bVal == null) return -1;
          const cmp = String(aVal).localeCompare(String(bVal));
          return orderBy.direction === "DESC" ? -cmp : cmp;
        });
      }
      if (limit !== undefined) {
        rows = rows.slice(0, limit);
      }
      return rows;
    },

    count(table: string, where?: { column: string; value: unknown }): number {
      if (where) {
        return (tables[table] ?? []).filter((r) => r[where.column] === where.value).length;
      }
      return (tables[table] ?? []).length;
    },

    insert(table: string, row: RowRecord): void {
      if (!tables[table]) {
        tables[table] = [];
      }
      const id = String(nextId++);
      tables[table].push({ ...row, id });
    },
  };
}

let dbInstance: InMemoryDatabase | null = null;

function openInMemory(): InMemoryDatabase {
  if (!dbInstance) {
    dbInstance = createInMemoryDatabase();
    dbInstance.exec(SCHEMA);
  }
  return dbInstance;
}

function openNode(): DatabaseLike {
  if (!DatabaseSync) {
    throw new Error("node:sqlite is not available in this runtime");
  }
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // ignore filesystem errors in restricted runtimes
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  applyMigrations(db as unknown as DatabaseLike);
  return db as unknown as DatabaseLike;
}

// 幂等迁移：为既有库补列（SQLite 无 ADD COLUMN IF NOT EXISTS）。
// final_action：人审后的实际处置动作（规则挖掘的数据源）；drift_id：漂移复核任务回链漂移记录。
function applyMigrations(db: DatabaseLike): void {
  const alters = [
    "ALTER TABLE workflow_task ADD COLUMN final_action TEXT",
    "ALTER TABLE workflow_task ADD COLUMN drift_id TEXT",
  ];
  for (const sql of alters) {
    try {
      db.exec(sql);
    } catch {
      // 列已存在：忽略
    }
  }
}

export function open(): DatabaseLike {
  if (isWorkers) {
    return openInMemory();
  }
  try {
    return openNode();
  } catch {
    return openInMemory();
  }
}

export function getDb(): DatabaseLike {
  const g = globalThis as GlobalDb;
  if (!g.__releaseGateDb) {
    g.__releaseGateDb = open();
  }
  return g.__releaseGateDb;
}

export { DB_PATH };
