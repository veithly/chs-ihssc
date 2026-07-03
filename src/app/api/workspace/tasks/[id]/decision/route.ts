import { NextResponse } from "next/server";
import { decideWorkflowTask } from "@/lib/workspace/taskDecision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/workspace/tasks/[id]/decision
// body: { decision: "approve" | "reject", final_action?, reviewer, notes? }
// 人审反馈闭环入口：批准时必须给 final_action（实际处置动作），
// 写入 workflow_task.final_action + 不可变 approval_decision_log（规则挖掘的数据源）。
// 带 drift_id 的漂移复核任务会同步流转漂移队列状态（resolved/dismissed）。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { decision?: string; final_action?: string; reviewer?: string; notes?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }

  if (body.decision !== "approve" && body.decision !== "reject") {
    return NextResponse.json({ ok: false, message: "decision 必须是 approve 或 reject。" }, { status: 400 });
  }

  const result = decideWorkflowTask({
    taskId: id,
    decision: body.decision,
    finalAction: body.final_action,
    reviewer: body.reviewer || "价格治理审核员",
    notes: body.notes,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
