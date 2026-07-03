import { NextResponse } from "next/server";
import {
  ratifyRuleCandidate,
  rejectRuleCandidate,
  resumeRuleCandidate,
  suspendRuleCandidate,
} from "@/lib/workspace/rules";
import { logDecision } from "@/lib/workspace/rules";
import { workspaceDb, workspaceNow } from "@/lib/workspace/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/workspace/rule-candidates/[id]/decision
// body: { decision: "approve" | "reject" | "suspend" | "resume", reviewer, notes? }
// approve → status=active，下批 run 自动复用；reject → status=rejected；
// suspend → active 规则一键停用（自动化可回滚，下批立即回人审）；resume → 恢复。
// 全部人审决策写入不可变 approval_decision_log。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { decision?: string; reviewer?: string; notes?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const decision = body.decision;
  const reviewer = body.reviewer || "业务审核员";
  const now = workspaceNow();

  if (decision === "approve") {
    const ok = ratifyRuleCandidate(id, reviewer, body.notes);
    if (!ok) {
      return NextResponse.json({ ok: false, message: "未找到待审候选，或状态已变更。" }, { status: 404 });
    }
    logDecision(workspaceDb(), {
      thread_id: null,
      run_id: null,
      target_type: "rule",
      target_id: id,
      decision: "ratify_rule",
      reason_codes: ["human_approved_rule"],
      context: { reviewer, notes: body.notes },
      actor_type: "human",
      actor_id: reviewer,
      rule_candidate_id: id,
    });
    return NextResponse.json({ ok: true, id, status: "active", decided_at: now });
  }

  if (decision === "reject") {
    const ok = rejectRuleCandidate(id, reviewer, body.notes);
    if (!ok) {
      return NextResponse.json({ ok: false, message: "未找到待审候选，或状态已变更。" }, { status: 404 });
    }
    logDecision(workspaceDb(), {
      thread_id: null,
      run_id: null,
      target_type: "rule",
      target_id: id,
      decision: "reject_rule",
      reason_codes: ["human_rejected_rule"],
      context: { reviewer, notes: body.notes },
      actor_type: "human",
      actor_id: reviewer,
      rule_candidate_id: id,
    });
    return NextResponse.json({ ok: true, id, status: "rejected", decided_at: now });
  }

  if (decision === "suspend") {
    const ok = suspendRuleCandidate(id, reviewer, body.notes);
    if (!ok) {
      return NextResponse.json({ ok: false, message: "未找到激活规则，或状态已变更。" }, { status: 404 });
    }
    logDecision(workspaceDb(), {
      thread_id: null,
      run_id: null,
      target_type: "rule",
      target_id: id,
      decision: "suspend_rule",
      reason_codes: ["human_suspended_rule"],
      context: { reviewer, notes: body.notes },
      actor_type: "human",
      actor_id: reviewer,
      rule_candidate_id: id,
    });
    return NextResponse.json({ ok: true, id, status: "suspended", decided_at: now });
  }

  if (decision === "resume") {
    const ok = resumeRuleCandidate(id, reviewer, body.notes);
    if (!ok) {
      return NextResponse.json({ ok: false, message: "未找到已停用规则，或状态已变更。" }, { status: 404 });
    }
    logDecision(workspaceDb(), {
      thread_id: null,
      run_id: null,
      target_type: "rule",
      target_id: id,
      decision: "resume_rule",
      reason_codes: ["human_resumed_rule"],
      context: { reviewer, notes: body.notes },
      actor_type: "human",
      actor_id: reviewer,
      rule_candidate_id: id,
    });
    return NextResponse.json({ ok: true, id, status: "active", decided_at: now });
  }

  return NextResponse.json(
    { ok: false, message: "decision 必须是 approve / reject / suspend / resume。" },
    { status: 400 },
  );
}
