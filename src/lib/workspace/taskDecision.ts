import "server-only";
import { getDb } from "../db";
import { workspaceNow } from "./repo";
import { logDecision } from "./rules";

// ===== V2.2 任务级人审决策 =====
// 人审反馈闭环的入口：价格治理岗在"人审任务"里批准/驳回一条 workflow_task，
// 批准时记录实际处置动作 final_action（如"集采催办""机构核实"）。
// 决策写入不可变 approval_decision_log（context 携带 issue_type/severity/final_action），
// 这份日志就是 mineRuleCandidates 挖掘规则候选的数据源——"从人审反馈学"由此成立。

const DECIDED_STATUSES = new Set(["已人审确认", "已驳回", "自动处置"]);

export interface TaskDecisionInput {
  taskId: string;
  decision: "approve" | "reject";
  finalAction?: string;
  reviewer: string;
  notes?: string;
}

export interface TaskDecisionResult {
  ok: boolean;
  message: string;
  taskId?: string;
  status?: string;
  finalAction?: string | null;
}

export function decideWorkflowTask(input: TaskDecisionInput): TaskDecisionResult {
  const db = getDb();
  const task = db
    .prepare("SELECT * FROM workflow_task WHERE id = :id LIMIT 1")
    .get({ id: input.taskId }) as
    | {
        id: string;
        thread_id: string;
        run_id: string;
        disposition_id: string | null;
        drift_id: string | null;
        task_type: string;
        owner_role: string;
        status: string;
        priority: string;
      }
    | null;
  if (!task) {
    return { ok: false, message: "未找到该任务。" };
  }
  if (DECIDED_STATUSES.has(task.status)) {
    return { ok: false, message: `任务状态为「${task.status}」，不能重复决策。` };
  }
  if (input.decision === "approve" && !input.finalAction?.trim()) {
    return { ok: false, message: "批准处置必须选择 final_action（实际处置动作）。" };
  }

  // 反查 issue_type / severity：优先 disposition，其次漂移记录，最后从任务字段推断。
  let issueType = "";
  let severity = "";
  if (task.disposition_id) {
    const disp = db
      .prepare("SELECT issue_type, severity FROM disposition_item WHERE id = :id LIMIT 1")
      .get({ id: task.disposition_id }) as { issue_type: string; severity: string } | null;
    if (disp) {
      issueType = disp.issue_type;
      severity = disp.severity;
    }
  }
  if (!issueType && task.drift_id) {
    const drift = db
      .prepare("SELECT rule_key, severity FROM policy_drift_log WHERE id = :id LIMIT 1")
      .get({ id: task.drift_id }) as { rule_key: string; severity: string } | null;
    if (drift) {
      issueType = drift.rule_key;
      severity = drift.severity;
    }
  }
  if (!issueType) {
    issueType = task.task_type;
    severity = task.priority === "high" ? "high" : "medium";
  }

  const now = workspaceNow();
  const approved = input.decision === "approve";
  const newStatus = approved ? "已人审确认" : "已驳回";
  const finalAction = approved ? input.finalAction!.trim() : null;

  db.prepare(
    `UPDATE workflow_task
     SET status = :status, final_action = :final_action, updated_at = :now
     WHERE id = :id`,
  ).run({ status: newStatus, final_action: finalAction, now, id: task.id });

  // 漂移复核任务：同步漂移队列状态流转（resolved / dismissed）
  if (task.drift_id) {
    db.prepare("UPDATE policy_drift_log SET status = :status WHERE id = :id").run({
      status: approved ? "resolved" : "dismissed",
      id: task.drift_id,
    });
  }

  logDecision(db, {
    thread_id: task.thread_id,
    run_id: task.run_id,
    target_type: task.disposition_id ? "disposition" : "workflow_task",
    target_id: task.disposition_id ?? task.id,
    decision: approved ? "human_approved" : "human_rejected",
    reason_codes: approved ? ["human_reviewed_disposition"] : ["human_rejected_disposition"],
    context: {
      issue_type: issueType,
      severity,
      final_action: finalAction,
      task_type: task.task_type,
      owner_role: task.owner_role,
      priority: task.priority,
      drift_id: task.drift_id,
    },
    actor_type: "human",
    actor_id: input.reviewer,
    notes: input.notes,
  });

  return {
    ok: true,
    message: approved
      ? `已人审确认，处置动作「${finalAction}」已写入决策日志（可被规则挖掘复用）。`
      : "已驳回，决策日志已留痕。",
    taskId: task.id,
    status: newStatus,
    finalAction,
  };
}
