import { NextResponse } from "next/server";
import { getMorningSession } from "@/lib/repo";
import { runMorningSessionAgent } from "@/lib/agent/runMorningSessionAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const current = getMorningSession(id);
  if (!current) {
    return NextResponse.json({ ok: false, message: "未找到晨会。" }, { status: 404 });
  }

  let body: { priorityText?: string; openedBy?: string; orgScope?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式不正确，请重新提交。" }, { status: 400 });
  }

  const result = await runMorningSessionAgent({
    openedBy: body.openedBy || current.opened_by,
    orgScope: body.orgScope || current.org_scope,
    priorityText: body.priorityText,
    rerankFromSessionId: current.id,
  });
  return NextResponse.json(result, { status: 200 });
}
