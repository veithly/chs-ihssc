import { NextResponse } from "next/server";
import { getScanProgress } from "@/lib/agent/scanProgress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const releaseId = new URL(req.url).searchParams.get("releaseId");
  if (!releaseId) {
    return NextResponse.json({ ok: false, message: "缺少 releaseId。" }, { status: 400 });
  }
  const progress = getScanProgress(releaseId);
  return NextResponse.json({ ok: true, progress });
}
