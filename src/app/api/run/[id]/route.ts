import { NextResponse } from "next/server";
import {
  getApprovalsByRun,
  getCorrectionsByRun,
  getIssuesByRun,
  getQuarantineByRun,
  getReplayByRun,
  getRun,
} from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ ok: false, message: "run not found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      release_id: run.release_id,
      mutation_type: run.mutation_type,
      input_summary: run.input_summary,
      candidate: JSON.parse(run.candidate_json || "{}"),
      plan: JSON.parse(run.plan_json),
      tools: JSON.parse(run.tools_json),
      provider_meta: JSON.parse(run.provider_meta_json),
      result_state: run.result_state,
      before_state: run.before_state,
      after_state: run.after_state,
      status: run.status,
      error_category: run.error_category,
      output_hash: run.output_hash,
      duration_ms: run.duration_ms,
      started_at: run.started_at,
      finished_at: run.finished_at,
    },
    issues: getIssuesByRun(run.id),
    corrections: getCorrectionsByRun(run.id),
    quarantine: getQuarantineByRun(run.id),
    approvals: getApprovalsByRun(run.id),
    replay: JSON.parse(getReplayByRun(run.id)?.events_json ?? "[]"),
  });
}
