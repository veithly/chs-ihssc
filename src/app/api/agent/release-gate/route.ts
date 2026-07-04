import { NextResponse } from "next/server";
import { runReleaseGateAgent } from "@/lib/agent/runReleaseGateAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trigger a whole-batch scan. The Agent reads every row in the release, runs the
// deterministic validators, writes per-row issues/corrections/quarantine/
// approvals, and resolves the aggregate release state.
export async function POST(req: Request) {
  let body: { releaseId?: string };
  try {
    body = (await req.json()) as { releaseId?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式不正确，请重新提交。" }, { status: 400 });
  }

  if (!body.releaseId) {
    return NextResponse.json({ ok: false, message: "缺少 releaseId。" }, { status: 400 });
  }

  const result = await runReleaseGateAgent({ releaseId: body.releaseId });

  // Degraded/failed runs return 200 with the honest result payload so the UI
  // and smoke harness can render the degraded state (no fake success).
  return NextResponse.json(result, { status: 200 });
}
