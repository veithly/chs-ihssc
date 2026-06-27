import { NextResponse } from "next/server";
import { updateDailyLeadAction } from "@/lib/repo";
import type { DailyLeadAction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: DailyLeadAction[] = [
  "request_evidence",
  "route_verification",
  "move_disposal",
  "observe",
  "exclude",
  "record_response",
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { action?: DailyLeadAction; actor?: string; note?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }

  if (!body.action || !ACTIONS.includes(body.action)) {
    return NextResponse.json({ ok: false, message: "不支持的线索动作。" }, { status: 400 });
  }

  const result = updateDailyLeadAction(
    id,
    body.action,
    body.actor?.trim() || "价格治理岗",
    body.note?.trim() || "",
  );
  if (!result) {
    return NextResponse.json({ ok: false, message: "未找到线索。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...result });
}
