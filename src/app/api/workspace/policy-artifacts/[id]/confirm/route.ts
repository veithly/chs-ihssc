import { NextResponse } from "next/server";
import { confirmPolicyArtifact, rejectPolicyArtifact } from "@/lib/policy/fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/workspace/policy-artifacts/[id]/confirm
// body: { action?: "confirm"|"reject", item_code, item_name?, reference_price?, ceiling_price?, collective_price?, reviewer }
// 人审确认公告 artifact → 结构化字段生效为 policy_fact（source_hash 指向 artifact）→ 下次 run 检出漂移。
// 政策事实未经人审确认不进入自动判定。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: {
    action?: string;
    item_code?: string;
    item_name?: string;
    reference_price?: number;
    ceiling_price?: number;
    collective_price?: number;
    reviewer?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式不正确，请重新提交。" }, { status: 400 });
  }

  const reviewer = body.reviewer || "政策事实审核员";

  if (body.action === "reject") {
    const result = rejectPolicyArtifact(id, reviewer);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  if (!body.item_code) {
    return NextResponse.json({ ok: false, message: "缺少 item_code（结构化事实必须挂到医保项目编码）。" }, { status: 400 });
  }

  const result = confirmPolicyArtifact({
    artifactId: id,
    reviewer,
    itemCode: body.item_code,
    itemName: body.item_name,
    referencePrice: body.reference_price,
    ceilingPrice: body.ceiling_price,
    collectivePrice: body.collective_price,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
