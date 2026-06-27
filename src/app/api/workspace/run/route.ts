import { NextResponse } from "next/server";
import { runWorkspaceAgent } from "@/lib/agent/runWorkspaceAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { threadId?: string; instruction?: string; promptKey?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }

  if (!body.threadId) {
    return NextResponse.json({ ok: false, message: "缺少 threadId。" }, { status: 400 });
  }

  const result = await runWorkspaceAgent({
    threadId: body.threadId,
    instruction: body.instruction ?? "",
    promptKey: body.promptKey ?? null,
  });
  return NextResponse.json(result, { status: 200 });
}
