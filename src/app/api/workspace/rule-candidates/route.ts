import { NextResponse } from "next/server";
import { listRuleCandidates, mineRuleCandidates } from "@/lib/workspace/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/workspace/rule-candidates?status=pending_review
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const candidates = listRuleCandidates(status);
  return NextResponse.json({ ok: true, candidates });
}

// POST /api/workspace/rule-candidates { action: "mine", minSupport?, minConfidence? }
// 从历史审批决策日志挖掘新的规则候选（频繁模式，简化版）。
export async function POST(req: Request) {
  let body: { action?: string; minSupport?: number; minConfidence?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }

  if (body.action === "mine") {
    const result = mineRuleCandidates({
      minSupport: body.minSupport,
      minConfidence: body.minConfidence,
    });
    return NextResponse.json({ ok: true, proposed: result.proposed, scannedDecisions: result.scannedDecisions });
  }

  return NextResponse.json({ ok: false, message: "未知 action，支持 'mine'。" }, { status: 400 });
}
