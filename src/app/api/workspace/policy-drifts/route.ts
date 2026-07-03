import { NextResponse } from "next/server";
import { listPolicyDrifts } from "@/lib/workspace/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/workspace/policy-drifts?status=detected
// 列出政策漂移日志（漂移检测的演示入口）。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const drifts = listPolicyDrifts(status);
  return NextResponse.json({ ok: true, drifts });
}
