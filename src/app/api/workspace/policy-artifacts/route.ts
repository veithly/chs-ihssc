import { NextResponse } from "next/server";
import { getLatestIngestionRun, listPolicyArtifacts } from "@/lib/policy/fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/workspace/policy-artifacts?status=fetched
// 抓取到的政策公告 artifact（人审确认后才会生成 policy_fact）。
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const artifacts = listPolicyArtifacts(status);
  return NextResponse.json({ ok: true, artifacts, latestIngestion: getLatestIngestionRun() });
}
