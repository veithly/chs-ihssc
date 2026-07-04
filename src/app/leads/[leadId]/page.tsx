import Link from "next/link";
import { Badge } from "@radix-ui/themes";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { FollowUpResponseAction, LeadActionBar } from "@/components/MorningWorkbench";
import { ReplayTimelineView } from "@/components/ReplayTimelineView";
import {
  getDailyLead,
  getMorningSession,
  getReplayBySession,
  listFollowUpTasksByLead,
} from "@/lib/repo";
import type { ReplayEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LeadPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const lead = getDailyLead(leadId);

  if (!lead) {
    return (
      <div className="gate-shell">
        <AppHeader active="价格晨会" />
        <main className="lead-empty">
          <h1>未找到线索：{leadId}</h1>
          <p>
            返回{" "}
            <Link href="/morning" className="lead-empty-link">
              价序
            </Link>{" "}
            查看今日线索。
          </p>
        </main>
        <style>{`
          .lead-empty {
            max-width: 760px;
            margin: 80px auto;
            padding: 24px;
            text-align: center;
          }
          .lead-empty h1 {
            font-size: 22px;
            font-weight: 600;
            letter-spacing: -0.02em;
            color: var(--gate-ink);
            margin: 0 0 8px;
          }
          .lead-empty p {
            color: var(--gate-ink-soft);
            font-size: 13.5px;
            margin: 0;
          }
          .lead-empty-link {
            color: var(--gate-accent);
            font-weight: 600;
          }
        `}</style>
      </div>
    );
  }

  const session = getMorningSession(lead.session_id);
  const tasks = listFollowUpTasksByLead(lead.id);
  const replay = JSON.parse(
    getReplayBySession(lead.session_id)?.events_json ?? "[]",
  ) as (ReplayEvent & { human?: boolean })[];
  const reasons = safeArray(lead.priority_reasons_json);
  const gaps = safeArray(lead.evidence_gap_json);
  const evidence = safeJson(lead.evidence_json);

  return (
    <div className="gate-shell">
      <AppHeader active="价格晨会" />
      <Breadcrumb items={["价序", "价格晨会", session?.session_date || lead.session_id, lead.id]} />
      <main className="lead-shell">
        <div className="lead-detail-grid" data-lead-detail>
          <section className="lead-detail-main">
            <div className="lead-detail-head-row">
              <Badge color="amber" variant="soft" radius="full">{lead.lead_type}</Badge>
              <Badge color="gray" variant="soft" radius="full">{lead.status}</Badge>
            </div>
            <h1>{lead.item_name}</h1>
            <p className="lead-detail-sub">
              {lead.institution_name_masked} · {lead.region_code || "跨来源"} ·{" "}
              <span className="mono">优先分 {lead.priority_score.toFixed(0)}</span>
            </p>

            <div className="metric-strip">
              <MiniMetric label="基准价" value={money(lead.baseline_price)} />
              <MiniMetric label="执行价" value={money(lead.execution_price)} />
              <MiniMetric label="差异" value={lead.delta_pct === null ? "-" : `${lead.delta_pct}%`} />
            </div>

            <section className="plain-section">
              <h2>为什么今天先看它</h2>
              <div className="lead-reasons detail">
                {reasons.map((reason) => <span key={reason}>{reason}</span>)}
              </div>
            </section>

            <section className="plain-section">
              <h2>还缺什么证据</h2>
              <div className="gap-list">
                {gaps.map((gap) => <span key={gap}>{gap}</span>)}
              </div>
            </section>

            <section className="human-boundary">
              <strong>人工边界</strong>
              <p>价序只排优先级和生成待办。发函、通报、违规认定、关闭线索，都必须由业务人员确认。</p>
            </section>

            <LeadActionBar leadId={lead.id} />
          </section>

          <aside className="lead-detail-side">
            <section className="gate-card lead-side-card">
              <div className="panel-head tight">
                <strong>来源摘要</strong>
                <span className="mono">{Object.keys(evidence).length} 项</span>
              </div>
              <dl className="evidence-list">
                {Object.entries(evidence).slice(0, 7).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
                {Object.keys(evidence).length === 0 && (
                  <p style={{ color: "var(--gate-ink-soft)", fontSize: 12.5, margin: 0 }}>
                    暂无来源摘要。
                  </p>
                )}
              </dl>
            </section>

            <section className="gate-card lead-side-card">
              <div className="panel-head tight">
                <strong>待办</strong>
                <span className="mono">{tasks.length}</span>
              </div>
              <div className="task-list">
                {tasks.map((task) => (
                  <div key={task.id} className="task-row">
                    <div>
                      {task.task_type} · <span className="mono">{task.status}</span>
                    </div>
                    <span>{task.message_draft}</span>
                    <div className="task-row-actions">
                      <FollowUpResponseAction taskId={task.id} />
                    </div>
                  </div>
                ))}
                {tasks.length === 0 && (
                  <p style={{ color: "var(--gate-ink-soft)", margin: 0, fontSize: 12.5 }}>
                    暂无待办。
                  </p>
                )}
              </div>
            </section>

            <section className="gate-card lead-side-card">
              <div className="panel-head tight">
                <strong>处置回放</strong>
                <span className="mono">{replay.length} 步</span>
              </div>
              <div style={{ marginTop: 12 }}>
                <ReplayTimelineView events={replay} />
              </div>
            </section>
          </aside>
        </div>
      </main>
      <style>{`
        .lead-shell {
          max-width: 1320px;
          margin: 0 auto;
          padding: 14px 24px 44px;
        }
        .lead-detail-head-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .lead-side-card {
          padding: 18px;
        }
        @media (max-width: 820px) {
          .lead-shell { padding: 12px 14px 32px; }
        }
      `}</style>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}

function money(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(2)} 元`;
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
