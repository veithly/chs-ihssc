import { NextResponse } from "next/server";
import { getGovernanceMetrics } from "@/lib/workspace/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/workspace/metrics
// 治理效能指标：自动分流率、规则命中、漂移闭环、政策事实指纹、估算节省人时。
// 全部从本地库实时计算，口径随值返回，可与决策日志逐条对账。
export async function GET() {
  return NextResponse.json({ ok: true, metrics: getGovernanceMetrics() });
}
