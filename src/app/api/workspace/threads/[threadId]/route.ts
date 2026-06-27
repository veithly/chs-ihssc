import { NextResponse } from "next/server";
import { getWorkspaceSnapshot } from "@/lib/workspace/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await params;
  const snapshot = getWorkspaceSnapshot(threadId);
  if (!snapshot.thread) {
    return NextResponse.json({ ok: false, message: "未找到会话。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, snapshot });
}
