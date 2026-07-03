import { NextResponse } from "next/server";
import { listDecisionLog } from "@/lib/workspace/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/workspace/decision-log?limit=12
// 不可变审批决策日志（自动 + 人审全留痕）。审计条与 claim/evidence 数据源。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "12");
  const decisions = listDecisionLog(Number.isFinite(limit) ? limit : 12);
  return NextResponse.json({ ok: true, decisions });
}
