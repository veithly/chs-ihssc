import { NextResponse } from "next/server";
import { simulatePolicyUpdate } from "@/lib/workspace/drift";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/workspace/policy-update
// body: { itemCode, reference_price?, ceiling_price?, collective_price? }
// 模拟一次政策更新（如集采中选价下调）。触发后，下次 agent run 会检出漂移。
// 生产环境应由真实政策采集覆盖；本接口用于演示"政策变了→存量数据漂移"。
export async function POST(req: Request) {
  let body: { itemCode?: string; reference_price?: number; ceiling_price?: number; collective_price?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }

  if (!body.itemCode) {
    return NextResponse.json({ ok: false, message: "缺少 itemCode。" }, { status: 400 });
  }

  const result = simulatePolicyUpdate(body.itemCode, {
    reference_price: body.reference_price,
    ceiling_price: body.ceiling_price,
    collective_price: body.collective_price,
  });

  if (!result.updated) {
    return NextResponse.json({ ok: false, message: "未找到该 item_code 的政策事实。" }, { status: 404 });
  }

  // 读回更新后的 baseline 供前端展示
  const db = getDb();
  const updated = db
    .prepare("SELECT item_code, item_name, reference_price, ceiling_price, collective_price, source_hash FROM policy_fact WHERE item_code = :code")
    .get({ code: body.itemCode });

  return NextResponse.json({
    ok: true,
    message: `政策事实已更新（${body.itemCode}）。下次 run 将检出漂移。`,
    baseline: updated,
    drift_expected: result.drift_expected,
  });
}
