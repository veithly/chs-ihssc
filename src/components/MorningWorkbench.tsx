"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, TextArea, TextField } from "@radix-ui/themes";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  LightningBoltIcon,
  LoopIcon,
  PaperPlaneIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import type { DailyLead, DailyLeadAction, MorningSession, ReplayEvent } from "@/lib/types";

type LeadView = DailyLead & {
  priority_reasons: string[];
  evidence_gap: string[];
  evidence: Record<string, unknown>;
};

export function MorningOpenPanel({
  todaySession,
  recentCount,
}: {
  todaySession: MorningSession | null;
  recentCount: number;
}) {
  const router = useRouter();
  const [priorityText, setPriorityText] = useState(
    "今天优先看集采落地差异、重点机构执行价、昨日未回访。",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openMorning() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/morning-sessions/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openedBy: "价格治理岗",
          orgScope: "市级医保价格治理岗",
          priorityText,
        }),
      });
      const data = (await res.json()) as { sessionId?: string; message?: string };
      if (data.sessionId) {
        router.push(`/morning/${data.sessionId}`);
        return;
      }
      setError(data.message || "晨会没有开成。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "晨会请求失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="morning-hero">
      <section className="morning-main">
        <div data-hero-text>
          <div className="agent-eyebrow">
            <span className="mono">价格处置晨会</span>
          </div>
          <h1 className="morning-title">今日价格处置晨会</h1>
          <p className="morning-subtitle">
            早上先把最该核、最该催、最该回访的价格线索排出来。系统会保留来源、排序理由和人工处理边界。
          </p>
        </div>

        <div className="source-strip" aria-label="今日来源">
          <span className="source-chip"><ReaderIcon /> 价格批次</span>
          <span className="source-chip"><LightningBoltIcon /> 集采落地</span>
          <span className="source-chip"><ExclamationTriangleIcon /> 重点对象</span>
          <span className="source-chip"><ClockIcon /> 昨日回访</span>
        </div>

        <label className="morning-label" htmlFor="priorityText">
          今天先看什么
        </label>
        <TextArea
          id="priorityText"
          size="3"
          value={priorityText}
          onChange={(e) => setPriorityText(e.target.value)}
          style={{ minHeight: 94 }}
        />
        <div className="consequence" style={{ marginTop: 12 }}>
          <strong>人工边界 · </strong>
          开晨会后会形成今日线索、回访任务和可回放记录。投诉和异常只能提高优先级，不能直接形成处置结论。
        </div>

        <div className="morning-cta-row">
          <button
            type="button"
            className="cta-primary"
            data-cta-primary
            disabled={busy}
            onClick={openMorning}
          >
            {busy ? <LoopIcon className="spin" /> : <LightningBoltIcon />}
            {busy ? "正在开晨会" : "开晨会"}
          </button>
          <span className="morning-cta-meta mono">
            {busy ? "正在整理今日线索" : "接入模型服务后，可自动排序今日线索"}
          </span>
        </div>
        {error && (
          <div className="morning-error" role="alert">
            {error}
          </div>
        )}
      </section>

      <aside className="morning-side">
        <div className="side-kicker">今天已有记录</div>
        {todaySession ? (
          <>
            <div className="side-value">{todaySession.lead_count}</div>
            <div className="side-copy">条线索已排好</div>
            <Link href={`/morning/${todaySession.id}`} className="side-link">
              回到今日晨会 <ArrowRightIcon />
            </Link>
          </>
        ) : (
          <>
            <div className="side-value">0</div>
            <div className="side-copy">还没开晨会</div>
          </>
        )}
        <div className="side-foot mono">最近 {recentCount} 次晨会可回放</div>
      </aside>
    </div>
  );
}

export function MorningSessionPanel({
  session,
  leads,
  replay,
}: {
  session: MorningSession;
  leads: DailyLead[];
  replay: ReplayEvent[];
}) {
  const parsedLeads = leads.map(enrichLead);
  const top = parsedLeads[0] ?? null;
  const statusSummary = safeJson(session.status_summary_json);
  const daybook = safeJson(session.daybook_summary_json);

  return (
    <div className="morning-session" data-morning-session-summary>
      <section className="session-band">
        <div>
          <div className={`agent-eyebrow ${session.status === "failed" ? "warn" : "ok"}`}>
            <span className="status-dot" aria-hidden />
            <span className="mono">{session.status === "failed" ? "PROVIDER FAILED · 失败态" : "SESSION PLANNED · 已开晨会"}</span>
          </div>
          <h1 className="session-title">{session.session_date} 价格处置晨会</h1>
          <p className="session-copy">
            {session.status === "failed"
              ? String(statusSummary.message || "模型服务未完成规划，系统没有伪造线索。")
              : `排出 ${session.lead_count} 条今日线索，先处理 ${top?.institution_name_masked || "重点对象"}。`}
          </p>
        </div>
        <div className="session-stats">
          <Stat label="来源批次" value={String(daybook.release_count ?? "-")} />
          <Stat label="扫描行" value={String(daybook.scanned_rows ?? "-")} />
          <Stat label="今日线索" value={String(session.lead_count)} />
        </div>
      </section>

      {session.status === "failed" ? (
        <section className="gate-card session-failed" style={{ padding: 22 }}>
          <div className="session-failed-head">
            <ExclamationTriangleIcon />
            <strong>没有生成机器排序</strong>
          </div>
          <p>
            这是诚实的失败态：模型服务不可用时，只保留来源摘要和回放，不把本地规则包装成"智能结论"。
          </p>
        </section>
      ) : (
        <div className="workbench-grid">
          <section className="lead-list-panel" data-daily-lead-list>
            <div className="panel-head">
              <strong>今日先办</strong>
              <span>{parsedLeads.length} 条</span>
            </div>
            <div className="lead-list">
              {parsedLeads.map((lead, index) => (
                <Link
                  href={`/leads/${lead.id}`}
                  key={lead.id}
                  className="lead-row"
                  data-next-step-cta={index === 0 ? "true" : undefined}
                >
                  <div className="lead-rank">{index + 1}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="lead-title">
                      {lead.lead_type} · {lead.institution_name_masked}
                    </div>
                    <div className="lead-sub">{lead.item_name}</div>
                    <div className="lead-reasons">
                      {lead.priority_reasons.slice(0, 3).map((r) => (
                        <span key={r}>{r}</span>
                      ))}
                    </div>
                  </div>
                  <div className="lead-score">{lead.priority_score.toFixed(0)}</div>
                </Link>
              ))}
              {parsedLeads.length === 0 && (
                <p style={{ color: "var(--gate-ink-soft)", margin: 0, fontSize: 13 }}>
                  今日没有待办线索。
                </p>
              )}
            </div>
          </section>

          <section className="top-lead-panel">
            <div className="panel-head">
              <strong>第一条怎么处置</strong>
              {top && <Badge color="amber" variant="soft" radius="full">{top.status}</Badge>}
            </div>
            {top ? (
              <>
                <h2>{top.item_name}</h2>
                <p>{top.next_action}</p>
                <div className="gap-list">
                  {top.evidence_gap.map((gap) => (
                    <span key={gap}>{gap}</span>
                  ))}
                </div>
                <Link href={`/leads/${top.id}`} className="primary-link">
                  打开线索 <ArrowRightIcon />
                </Link>
              </>
            ) : (
              <p style={{ color: "var(--gate-ink-soft)", fontSize: 13.5 }}>
                没有需要立即处置的线索。
              </p>
            )}
          </section>
        </div>
      )}

      <div className="session-bottom">
        <RerankBox sessionId={session.id} />
        <section className="gate-card" style={{ padding: 20 }} data-replay-mini>
          <div className="panel-head">
            <strong>回放</strong>
            <span>{replay.length} 步</span>
          </div>
          <div className="mini-timeline">
            {replay.slice(0, 5).map((event, i) => (
              <div key={`${event.title}-${i}`} className="mini-event">
                <CheckCircledIcon />
                <span>{event.title}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function LeadActionBar({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [actor, setActor] = useState("价格治理岗");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<DailyLeadAction | null>(null);

  async function act(action: DailyLeadAction) {
    setBusy(action);
    await fetch(`/api/daily-leads/${leadId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, actor, note }),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="action-box">
      <div className="action-fields">
        <TextField.Root value={actor} onChange={(e) => setActor(e.target.value)} placeholder="处理人" />
        <TextField.Root value={note} onChange={(e) => setNote(e.target.value)} placeholder="处理备注" />
      </div>
      <div className="action-buttons">
        <Button disabled={Boolean(busy)} onClick={() => act("request_evidence")} data-action-evidence>
          <PaperPlaneIcon /> 退回补证
        </Button>
        <Button disabled={Boolean(busy)} variant="soft" onClick={() => act("route_verification")} data-action-verify>
          <ReaderIcon /> 派核验
        </Button>
        <Button disabled={Boolean(busy)} color="red" variant="soft" onClick={() => act("move_disposal")} data-action-disposal>
          <ExclamationTriangleIcon /> 转处置待确认
        </Button>
        <Button disabled={Boolean(busy)} color="gray" variant="soft" onClick={() => act("observe")} data-action-observe>
          <ClockIcon /> 观察
        </Button>
      </div>
    </div>
  );
}

export function FollowUpResponseAction({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [responder, setResponder] = useState("机构联系人");
  const [summary, setSummary] = useState("");
  const [complete, setComplete] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/follow-up-tasks/${taskId}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responder, summary, complete }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) throw new Error(data.message || "反馈记录失败。");
      setOpen(false);
      setSummary("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "反馈记录失败。");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="1" variant="soft" onClick={() => setOpen(true)} data-follow-up-response>
        <PaperPlaneIcon /> 记录反馈
      </Button>
    );
  }

  return (
    <div className="follow-response-panel" data-follow-up-response-form>
      <TextField.Root
        size="2"
        value={responder}
        onChange={(e) => setResponder(e.target.value)}
        placeholder="反馈人"
      />
      <TextArea
        size="2"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="记录补证、回函或电话反馈摘要"
      />
      <label className="follow-response-check">
        <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
        <span>本次反馈已完成</span>
      </label>
      <div className="follow-response-actions">
        <Button size="1" disabled={busy || !summary.trim()} onClick={submit}>
          {busy ? <LoopIcon className="spin" /> : <CheckCircledIcon />} 保存反馈
        </Button>
        <Button size="1" variant="soft" color="gray" disabled={busy} onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
      {error && <div className="follow-response-error">{error}</div>}
    </div>
  );
}

function RerankBox({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [priorityText, setPriorityText] = useState("下午临时优先看市人民医院和冠脉支架。");
  const [busy, setBusy] = useState(false);

  async function rerank() {
    setBusy(true);
    const res = await fetch(`/api/morning-sessions/${sessionId}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priorityText, openedBy: "价格治理岗" }),
    });
    const data = (await res.json()) as { sessionId?: string };
    setBusy(false);
    if (data.sessionId) router.push(`/morning/${data.sessionId}`);
  }

  return (
    <section className="gate-card" style={{ padding: 20 }}>
      <div className="panel-head">
        <strong>改一下今天的关注点</strong>
        <Badge color="gray" variant="soft" radius="full">重排</Badge>
      </div>
      <TextArea size="2" value={priorityText} onChange={(e) => setPriorityText(e.target.value)} />
      <Button style={{ marginTop: 10 }} disabled={busy} onClick={rerank}>
        {busy ? <LoopIcon className="spin" /> : <LightningBoltIcon />} 重排晨会
      </Button>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function enrichLead(lead: DailyLead): LeadView {
  return {
    ...lead,
    priority_reasons: safeArray(lead.priority_reasons_json),
    evidence_gap: safeArray(lead.evidence_gap_json),
    evidence: safeJson(lead.evidence_json),
  };
}

function safeArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJson(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
