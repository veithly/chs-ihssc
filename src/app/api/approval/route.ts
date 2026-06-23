import { NextResponse } from "next/server";
import { decideApproval } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    approvalId?: string;
    decision?: "approved" | "rejected";
    approver?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }
  if (!body.approvalId || (body.decision !== "approved" && body.decision !== "rejected")) {
    return NextResponse.json(
      { ok: false, message: "缺少 approvalId 或 decision。" },
      { status: 400 },
    );
  }
  const result = decideApproval(
    body.approvalId,
    body.decision,
    body.approver?.trim() || "业务审批人",
    body.notes?.trim() || "",
  );
  if (!result) {
    return NextResponse.json({ ok: false, message: "未找到审批对象。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result });
}
