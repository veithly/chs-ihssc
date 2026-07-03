import { NextResponse } from "next/server";
import { dryRunRule } from "@/lib/workspace/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/workspace/rule-candidates/[id]/dry-run
// 激活前影响面预览：如果激活这条规则，将命中 N 条历史 case，
// 其中 M 条敏感项会被护栏挡回人审，K 条可自动处置。不改任何状态。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = dryRunRule(id);
  if (!result.found) {
    return NextResponse.json({ ok: false, message: "未找到该规则候选。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result });
}
