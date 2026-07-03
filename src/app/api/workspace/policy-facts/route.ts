import { NextResponse } from "next/server";
import { listPolicyFacts } from "@/lib/workspace/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/workspace/policy-facts
// 政策事实版本表（漂移检测的 baseline 真相源）。source_hash 即版本指纹。
export async function GET() {
  const facts = listPolicyFacts();
  return NextResponse.json({ ok: true, facts });
}
