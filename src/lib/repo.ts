import "server-only";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { getDb } from "./db";
import { ensureSeeded } from "./seed";
import type {
  AgentRun,
  CorrectionProposal,
  DatasetRelease,
  DatasetRow,
  QuarantineItem,
  ReleaseApproval,
  ReleaseState,
  ReplayTimeline,
  RowIssue,
  SourceManifest,
} from "./types";

let seeded = false;
function ready(): DatabaseSync {
  if (!seeded) {
    ensureSeeded();
    seeded = true;
  }
  return getDb();
}

// node:sqlite returns null-prototype Record rows; cast through unknown.
type Params = Record<string, SQLInputValue>;
function all<T>(sql: string, params?: Params): T[] {
  const stmt = ready().prepare(sql);
  return (params ? stmt.all(params) : stmt.all()) as unknown as T[];
}
function one<T>(sql: string, params?: Params): T | null {
  const stmt = ready().prepare(sql);
  return ((params ? stmt.get(params) : stmt.get()) as unknown as T) ?? null;
}

export function listReleases(): DatasetRelease[] {
  return all<DatasetRelease>(
    "SELECT * FROM dataset_release ORDER BY is_sample ASC, id ASC",
  );
}

export function getRelease(id: string): DatasetRelease | null {
  return one<DatasetRelease>("SELECT * FROM dataset_release WHERE id = :id", { id });
}

export function getRows(releaseId: string): DatasetRow[] {
  return all<DatasetRow>(
    "SELECT * FROM dataset_row WHERE release_id = :id ORDER BY row_index ASC",
    { id: releaseId },
  );
}

export function getRow(rowId: string): DatasetRow | null {
  return one<DatasetRow>("SELECT * FROM dataset_row WHERE id = :id", { id: rowId });
}

export function getManifest(releaseId: string): SourceManifest | null {
  return one<SourceManifest>("SELECT * FROM source_manifest WHERE release_id = :id", {
    id: releaseId,
  });
}

export interface AccessSnapshot {
  id: string;
  release_id: string;
  policy_version: string;
  rules_json: string;
  created_at: string;
}

export function getAccessSnapshot(releaseId: string): AccessSnapshot | null {
  return one<AccessSnapshot>(
    "SELECT * FROM access_rule_snapshot WHERE release_id = :id",
    { id: releaseId },
  );
}

export function updateReleaseState(
  id: string,
  state: ReleaseState,
  runId: string | null,
) {
  ready()
    .prepare(
      "UPDATE dataset_release SET state = :state, current_run_id = :runId WHERE id = :id",
    )
    .run({ id, state, runId });
}

export function getRun(runId: string): AgentRun | null {
  return one<AgentRun>("SELECT * FROM agent_run WHERE id = :id", { id: runId });
}

export function getLatestRun(releaseId: string): AgentRun | null {
  return one<AgentRun>(
    "SELECT * FROM agent_run WHERE release_id = :id ORDER BY started_at DESC LIMIT 1",
    { id: releaseId },
  );
}

export function getReplayByRun(runId: string): ReplayTimeline | null {
  return one<ReplayTimeline>("SELECT * FROM replay_timeline WHERE run_id = :id", {
    id: runId,
  });
}

export function getIssuesByRun(runId: string): RowIssue[] {
  return all<RowIssue>(
    "SELECT * FROM row_issue WHERE run_id = :id ORDER BY created_at ASC",
    { id: runId },
  );
}

export function getCorrectionsByRun(runId: string): CorrectionProposal[] {
  return all<CorrectionProposal>(
    "SELECT * FROM correction_proposal WHERE run_id = :id",
    { id: runId },
  );
}

export function getQuarantineByRun(runId: string): QuarantineItem[] {
  return all<QuarantineItem>("SELECT * FROM quarantine_item WHERE run_id = :id", {
    id: runId,
  });
}

export function getApprovalsByRun(runId: string): ReleaseApproval[] {
  return all<ReleaseApproval>("SELECT * FROM release_approval WHERE run_id = :id", {
    id: runId,
  });
}

export function getApproval(id: string): ReleaseApproval | null {
  return one<ReleaseApproval>("SELECT * FROM release_approval WHERE id = :id", { id });
}

export function listPendingApprovals(): (ReleaseApproval & { release_title: string })[] {
  return all<ReleaseApproval & { release_title: string }>(
    `SELECT a.*, r.title AS release_title FROM release_approval a
     JOIN dataset_release r ON r.id = a.release_id
     WHERE a.status = 'pending' ORDER BY a.created_at DESC`,
  );
}

export function listQuarantine(): (QuarantineItem & { release_title: string })[] {
  return all<QuarantineItem & { release_title: string }>(
    `SELECT q.*, r.title AS release_title FROM quarantine_item q
     JOIN dataset_release r ON r.id = q.release_id ORDER BY q.created_at DESC`,
  );
}

export function decideApproval(
  id: string,
  decision: "approved" | "rejected",
  approver: string,
  notes: string,
): { approval: ReleaseApproval; newState: ReleaseState } | null {
  const db = ready();
  const approval = getApproval(id);
  if (!approval) return null;
  const decidedAt = new Date().toISOString();
  db.prepare(
    `UPDATE release_approval SET status = :status, approver = :approver,
     human_notes = :notes, decided_at = :decidedAt WHERE id = :id`,
  ).run({ id, status: decision, approver, notes, decidedAt });

  const newState: ReleaseState = decision === "approved" ? "可发布" : "隔离";
  updateReleaseState(approval.release_id, newState, approval.run_id);

  // Append a human decision event, kept separate from the Agent recommendation.
  const replay = getReplayByRun(approval.run_id);
  if (replay) {
    try {
      const events = JSON.parse(replay.events_json) as unknown[];
      events.push({
        phase: "verify",
        title: `人工审批：${decision === "approved" ? "批准" : "拒绝"}`,
        detail: `审批人 ${approver} 将发布状态改为 ${newState}。备注：${notes || "（无）"}`,
        at: decidedAt,
        ok: true,
        human: true,
      });
      db.prepare("UPDATE replay_timeline SET events_json = :events WHERE id = :id").run({
        id: replay.id,
        events: JSON.stringify(events),
      });
    } catch {
      /* ignore malformed timeline */
    }
  }

  return { approval: getApproval(id)!, newState };
}
