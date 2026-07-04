import { NextResponse } from "next/server";
import { decideRepairPatch } from "@/lib/workspace/repairDecision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/workspace/repairs/[id]/decision
// body: { decision: "apply" | "dismiss", after_value?, reviewer? }
// 会话流修复提案卡入口：采纳（可携带人工编辑后的修复值）会真正回写数据集行，
// 忽略只做留痕。两种决策都写 approval_decision_log。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { decision?: string; after_value?: string; reviewer?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }

  if (body.decision !== "apply" && body.decision !== "dismiss") {
    return NextResponse.json(
      { ok: false, message: "decision 必须是 apply 或 dismiss。" },
      { status: 400 },
    );
  }

  const result = decideRepairPatch({
    patchId: id,
    decision: body.decision,
    afterValue: body.after_value,
    reviewer: body.reviewer || "价格治理审核员",
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
