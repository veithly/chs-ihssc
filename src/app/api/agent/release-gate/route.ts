import { NextResponse } from "next/server";
import { runReleaseGateAgent, type RunInput } from "@/lib/agent/runReleaseGateAgent";
import type { MutationType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: MutationType[] = [
  "none",
  "wrong_code",
  "future_date",
  "identity_conflict",
  "access_denied",
];

export async function POST(req: Request) {
  let body: Partial<RunInput>;
  try {
    body = (await req.json()) as Partial<RunInput>;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }

  if (!body.releaseId) {
    return NextResponse.json(
      { ok: false, message: "缺少 releaseId。" },
      { status: 400 },
    );
  }
  const mutationType = (body.mutationType ?? "none") as MutationType;
  if (!VALID.includes(mutationType)) {
    return NextResponse.json(
      { ok: false, message: `非法的 mutationType: ${mutationType}` },
      { status: 400 },
    );
  }

  const result = await runReleaseGateAgent({
    releaseId: body.releaseId,
    rowId: body.rowId,
    mutationType,
    override: body.override,
  });

  // Degraded/failed runs return 200 with the honest result payload so the UI
  // and smoke harness can render the degraded state (no fake success).
  return NextResponse.json(result, { status: 200 });
}
