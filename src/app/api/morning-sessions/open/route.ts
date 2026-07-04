import { NextResponse } from "next/server";
import { runMorningSessionAgent } from "@/lib/agent/runMorningSessionAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    openedBy?: string;
    orgScope?: string;
    priorityText?: string;
    sourceCutoffAt?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式不正确，请重新提交。" }, { status: 400 });
  }

  const result = await runMorningSessionAgent(body ?? {});
  return NextResponse.json(result, { status: 200 });
}
