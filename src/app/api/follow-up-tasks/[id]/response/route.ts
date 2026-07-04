import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { responder?: string; summary?: string; complete?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式不正确，请重新提交。" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE follow_up_task
       SET status = :status, response_json = :response, last_contact_at = :lastContactAt, updated_at = :updatedAt
       WHERE id = :id`,
    )
    .run({
      id,
      status: body.complete ? "responded" : "open",
      response: JSON.stringify({
        responder: body.responder || "机构联系人",
        summary: body.summary || "已记录反馈，待业务岗复核。",
        complete: Boolean(body.complete),
      }),
      lastContactAt: now,
      updatedAt: now,
    });

  if (info.changes === 0) {
    return NextResponse.json({ ok: false, message: "未找到回访任务。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id, status: body.complete ? "responded" : "open" });
}
