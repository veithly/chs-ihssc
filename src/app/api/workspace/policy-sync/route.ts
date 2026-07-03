import { NextResponse } from "next/server";
import { syncNhsaPolicySource } from "@/lib/policy/fetcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/workspace/policy-sync
// body: { dryRun?: boolean }
// 抓取国家医保局政策公告页，解析元数据+附件，hash 留痕，写 ingestion_run。
// 合规：只抓 L0 公开公告；不碰登录/CA/App 逆向/不公开支付标准。
export async function POST(req: Request) {
  let body: { dryRun?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await syncNhsaPolicySource({ dryRun: body.dryRun });

  if (result.error) {
    return NextResponse.json(
      { ok: false, message: `政策同步失败：${result.error}`, ingestionRunId: result.ingestionRunId },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: body.dryRun
      ? `（dry-run）解析到 ${result.fetchedCount} 条公告`
      : `已同步 ${result.fetchedCount} 条公告（新增/变更 ${result.changedCount} 条），留痕于 ${result.ingestionRunId}。`,
    ingestionRunId: result.ingestionRunId,
    fetchedCount: result.fetchedCount,
    changedCount: result.changedCount,
    sampleArtifacts: result.artifacts.slice(0, 5).map((a) => ({
      title: a.title,
      url: a.url,
      publishedAt: a.publishedAt,
      contentHash: a.contentHash,
    })),
  });
}
