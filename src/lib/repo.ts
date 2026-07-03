import "server-only";
import { getDb } from "./db";
import { ensureSeeded } from "./seed";
import {
  EDITABLE_FIELDS,
  type AgentRun,
  type CorrectionProposal,
  type DailyLead,
  type DailyLeadAction,
  type DailyLeadStatus,
  type DatasetRelease,
  type DatasetRow,
  type EditableField,
  type FollowUpTask,
  type MorningSession,
  type MorningSessionStatus,
  type QuarantineItem,
  type ReleaseApproval,
  type ReleaseState,
  type ReplayTimeline,
  type RowIssue,
  type SourceManifest,
  type WatchlistItem,
} from "./types";

let seeded = false;
function ready(): ReturnType<typeof getDb> {
  if (!seeded) {
    ensureSeeded();
    seeded = true;
  }
  return getDb();
}

// node:sqlite returns null-prototype Record rows; cast through unknown.
type Params = Record<string, unknown>;
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

// Operator free-edit: patch any subset of the editable fields on one row, then
// the batch can be re-scanned. Only whitelisted fields are writable.
export function updateRow(
  rowId: string,
  patch: Partial<Record<EditableField, string>>,
): DatasetRow | null {
  const entries = Object.entries(patch).filter(([k]) =>
    (EDITABLE_FIELDS as readonly string[]).includes(k),
  );
  if (entries.length === 0) return getRow(rowId);
  const setSql = entries.map(([k]) => `${k} = :${k}`).join(", ");
  const params: Params = { id: rowId };
  for (const [k, v] of entries) params[k] = String(v ?? "");
  ready()
    .prepare(`UPDATE dataset_row SET ${setSql} WHERE id = :id`)
    .run(params);
  return getRow(rowId);
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

  const newState: ReleaseState = decision === "approved" ? "可落地" : "异常处置";
  updateReleaseState(approval.release_id, newState, approval.run_id);

  // Append a human decision event, kept separate from the Agent recommendation.
  const replay = getReplayByRun(approval.run_id);
  if (replay) {
    try {
      const events = JSON.parse(replay.events_json) as unknown[];
      events.push({
        phase: "verify",
        title: `人工核验：${decision === "approved" ? "确认落地" : "转异常处置"}`,
        detail: `核验人 ${approver} 将治理状态改为 ${newState}。备注：${notes || "（无）"}`,
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

export function getTodayMorningSession(date = todayInShanghai()): MorningSession | null {
  return one<MorningSession>(
    `SELECT * FROM morning_session
     WHERE session_date = :date
     ORDER BY opened_at DESC, created_at DESC
     LIMIT 1`,
    { date },
  );
}

export function getMorningSession(id: string): MorningSession | null {
  return one<MorningSession>("SELECT * FROM morning_session WHERE id = :id", { id });
}

export function listMorningSessions(limit = 5): MorningSession[] {
  return all<MorningSession>(
    `SELECT * FROM morning_session
     ORDER BY session_date DESC, opened_at DESC, created_at DESC
     LIMIT :limit`,
    { limit },
  );
}

export function listDailyLeads(sessionId: string): DailyLead[] {
  return all<DailyLead>(
    `SELECT * FROM daily_lead
     WHERE session_id = :sessionId
     ORDER BY priority_score DESC, created_at ASC`,
    { sessionId },
  );
}

export function getDailyLead(id: string): DailyLead | null {
  return one<DailyLead>("SELECT * FROM daily_lead WHERE id = :id", { id });
}

export function listWatchlist(): WatchlistItem[] {
  return all<WatchlistItem>(
    `SELECT * FROM watchlist
     WHERE status = 'active'
     ORDER BY weight DESC, created_at DESC`,
  );
}

export function listFollowUpTasks(status?: string): FollowUpTask[] {
  if (!status) {
    return all<FollowUpTask>(
      `SELECT * FROM follow_up_task
       ORDER BY due_at IS NULL ASC, due_at ASC, updated_at DESC`,
    );
  }
  return all<FollowUpTask>(
    `SELECT * FROM follow_up_task
     WHERE status = :status
     ORDER BY due_at IS NULL ASC, due_at ASC, updated_at DESC`,
    { status },
  );
}

export function listFollowUpTasksByLead(leadId: string): FollowUpTask[] {
  return all<FollowUpTask>(
    `SELECT * FROM follow_up_task
     WHERE lead_id = :leadId
     ORDER BY created_at DESC`,
    { leadId },
  );
}

export function getReplayBySession(sessionId: string): ReplayTimeline | null {
  const session = getMorningSession(sessionId);
  if (!session?.agent_run_id) return null;
  return getReplayByRun(session.agent_run_id);
}

export function updateDailyLeadAction(
  id: string,
  action: DailyLeadAction,
  actor: string,
  note: string,
): { lead: DailyLead; task: FollowUpTask | null } | null {
  const db = ready();
  const lead = getDailyLead(id);
  if (!lead) return null;

  const now = new Date().toISOString();
  const actionMap: Record<
    DailyLeadAction,
    { status: DailyLeadStatus; nextAction: string; taskType?: string; evidence?: string[]; message?: string }
  > = {
    request_evidence: {
      status: "pending_evidence",
      nextAction: "已退回补证，等待机构补齐截图/票据/包装单位口径。",
      taskType: "补证",
      evidence: ["HIS 执行价截图", "订单或发票摘要", "包装单位说明"],
      message: "请补充执行价截图、订单或发票摘要，并说明包装单位口径。",
    },
    route_verification: {
      status: "pending_verification",
      nextAction: "已派给核验岗，等待确认政策调价、规格变更或区域落地原因。",
      taskType: "核验",
      evidence: ["政策调价依据", "规格/包装单位说明", "平台落地状态截图"],
      message: "请核验该价格差异是否来自政策调价、规格变更或区域落地口径。",
    },
    move_disposal: {
      status: "pending_disposal",
      nextAction: "已转入异常处置，需人工确认后才能形成处置结论。",
      taskType: "处置",
      evidence: ["处置依据", "机构说明", "复核记录"],
      message: "该线索拟转异常处置，请补齐处置依据并等待人工确认。",
    },
    observe: {
      status: "observing",
      nextAction: "已放入观察，明日晨会继续跟踪价格和材料变化。",
    },
    exclude: {
      status: "excluded",
      nextAction: "已排除本日处置，原因已记录，可在回放中查看。",
    },
    record_response: {
      status: "pending_follow_up",
      nextAction: "已记录回访反馈，等待业务岗复核材料完整性。",
      taskType: "回访",
      evidence: ["机构反馈摘要", "材料完整性判断"],
      message: "已收到反馈，请复核材料完整性并决定是否关闭线索。",
    },
  };
  const mapped = actionMap[action];

  db.prepare(
    `UPDATE daily_lead
     SET status = :status, next_action = :nextAction, owner_id = :actor, updated_at = :updatedAt
     WHERE id = :id`,
  ).run({
    id,
    status: mapped.status,
    nextAction: mapped.nextAction,
    actor,
    updatedAt: now,
  });

  let task: FollowUpTask | null = null;
  if (mapped.taskType) {
    const taskId = `FUP-${now.slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
    const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO follow_up_task
       (id, lead_id, session_id, task_type, assignee_type, assignee_id, evidence_required_json, message_draft, due_at, status, response_json, last_contact_at, created_by, created_at, updated_at)
       VALUES (:id, :lead_id, :session_id, :task_type, :assignee_type, :assignee_id, :evidence_required_json, :message_draft, :due_at, :status, :response_json, :last_contact_at, :created_by, :created_at, :updated_at)`,
    ).run({
      id: taskId,
      lead_id: lead.id,
      session_id: lead.session_id,
      task_type: mapped.taskType,
      assignee_type: lead.institution_id ? "institution" : "internal_role",
      assignee_id: lead.institution_id ?? lead.owner_role,
      evidence_required_json: JSON.stringify(mapped.evidence ?? []),
      message_draft: mapped.message ?? mapped.nextAction,
      due_at: due,
      status: "open",
      response_json: JSON.stringify({ action, actor, note }),
      last_contact_at: now,
      created_by: actor,
      created_at: now,
      updated_at: now,
    });
    task = one<FollowUpTask>("SELECT * FROM follow_up_task WHERE id = :id", { id: taskId });
  }

  const replay = getReplayBySession(lead.session_id);
  if (replay) {
    try {
      const events = JSON.parse(replay.events_json) as unknown[];
      events.push({
        phase: "verify",
        title: `人工动作：${actionLabel(action)}`,
        detail: `${actor} 处理线索 ${lead.id}：${mapped.nextAction}${note ? ` 备注：${note}` : ""}`,
        at: now,
        ok: true,
        human: true,
      });
      db.prepare("UPDATE replay_timeline SET events_json = :events WHERE id = :id").run({
        id: replay.id,
        events: JSON.stringify(events),
      });
    } catch {
      /* keep the original timeline if malformed */
    }
  }

  return { lead: getDailyLead(id)!, task };
}

function actionLabel(action: DailyLeadAction): string {
  const labels: Record<DailyLeadAction, string> = {
    request_evidence: "退回补证",
    route_verification: "派核验",
    move_disposal: "转处置",
    observe: "继续观察",
    exclude: "排除本日",
    record_response: "记录反馈",
  };
  return labels[action];
}

function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
