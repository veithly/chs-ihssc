import Link from "next/link";
import { Badge } from "@radix-ui/themes";
import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ResultTabs } from "@/components/ResultTabs";
import { ReplayTimelineView } from "@/components/ReplayTimelineView";
import { StateBadge } from "@/components/StateBadge";
import { CopyButton } from "@/components/ClientButtons";
import { getLatestRun, getRelease, getReplayByRun } from "@/lib/repo";
import type { AgentPlan, BatchStats, ReplayEvent, ToolCall } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const release = getRelease(id);
  const run = release ? getLatestRun(id) : null;

  return (
    <div className="gate-shell">
      <AppHeader active="价格治理" />
      <Breadcrumb items={["价格治理", "价格批次", id, "运行回放"]} />
      <main className="replay-shell">
        <ResultTabs releaseId={id} active="replay" />
        {!run ? (
          <EmptyReplay id={id} />
        ) : (
          <ReplayBody id={id} run={run} />
        )}
      </main>
    </div>
  );
}

function EmptyReplay({ id }: { id: string }) {
  return (
    <div className="gate-card replay-empty">
      <p>暂无运行回放。先运行一次价格治理。</p>
      <Link href={`/release/${id}`} className="replay-empty-link">
        前往价格治理 →
      </Link>
      <style>{`
        .replay-empty {
          padding: 44px;
          text-align: center;
        }
        .replay-empty p {
          margin: 0 0 14px;
          color: var(--gate-ink-soft);
          font-size: 14px;
        }
        .replay-empty-link {
          color: var(--gate-accent);
          font-weight: 600;
          font-size: 13.5px;
        }
      `}</style>
    </div>
  );
}

function ReplayBody({ id, run }: { id: string; run: NonNullable<ReturnType<typeof getLatestRun>> }) {
  const plan = JSON.parse(run.plan_json) as AgentPlan;
  const tools = JSON.parse(run.tools_json) as ToolCall[];
  const meta = JSON.parse(run.provider_meta_json) as Record<string, unknown>;
  const events = JSON.parse(getReplayByRun(run.id)?.events_json ?? "[]") as ReplayEvent[];
  const stats = JSON.parse(run.candidate_json || "{}") as Partial<BatchStats>;

  return (
    <div className="replay-grid">
      <section className="gate-card replay-main">
        <div className="replay-main-head">
          <div className="replay-main-id">
            <strong>智能体计划与工具调用</strong>
            <Badge className="mono" variant="soft" color="gray" radius="full">{run.id.slice(0, 14)}</Badge>
            <StateBadge state={run.result_state} />
          </div>
          <div className="replay-head-actions">
            <Link
              href={`/api/run/${run.id}`}
              target="_blank"
              rel="noreferrer"
              className="replay-json-link"
              data-run-json-link
            >
              查看运行 JSON
            </Link>
            <CopyButton text={`/release/${id}/replay`} />
          </div>
        </div>

        <div className="replay-plan">
          <div className="replay-plan-row">
            <span className="replay-plan-label">计划重点</span>
            <strong>{plan.issue_focus}</strong>
          </div>
          <div className="replay-plan-row">
            <span className="replay-plan-label">预计状态</span>
            <span>{plan.expected_state}</span>
          </div>
          <div className="replay-plan-row">
            <span className="replay-plan-label">规划说明</span>
            <span>live provider · {plan.rationale}</span>
          </div>
          <div className="mono replay-plan-meta">
            provider={String(meta.source)} · model={String(meta.model ?? "-")} · host={String(meta.baseUrlHost ?? "-")} · {String(meta.latency_ms ?? "-")}ms
          </div>
          {typeof stats.scanned === "number" && (
            <div className="mono replay-plan-meta">
              batch · 扫描 {stats.scanned} 行 · {stats.validations ?? 0} 次校验 · 命中 {stats.issues ?? 0} 处
            </div>
          )}
        </div>

        <div className="replay-tools-head">
          <span>工具调用轨迹</span>
          <span className="mono">{tools.length} 次</span>
        </div>
        <div data-tool-trace className="replay-tools">
          {tools.map((t, i) => (
            <div key={i} className="replay-tool-row">
              <span className="replay-tool-icon">
                {t.ok ? (
                  <CheckCircledIcon color="var(--gate-green)" />
                ) : (
                  <CrossCircledIcon color="var(--gate-amber)" />
                )}
              </span>
              <div className="replay-tool-body">
                <div className="replay-tool-head">
                  <code className="mono replay-tool-name">{t.tool}</code>
                  <span className="replay-tool-label">{t.label}</span>
                </div>
                <div className="mono replay-tool-io">
                  <span className="replay-tool-io-key">in</span>
                  <span className="replay-tool-io-val">{t.input}</span>
                </div>
                <div className="mono replay-tool-io">
                  <span className="replay-tool-io-key">out</span>
                  <span className="replay-tool-io-val">{t.output}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="gate-card replay-side">
        <div className="replay-side-head">
          <strong>observe · plan · tools · mutate · verify</strong>
        </div>
        <ReplayTimelineView events={events} />
      </aside>

      <style>{`
        .replay-shell {
          max-width: 1320px;
          margin: 0 auto;
          padding: 14px 24px 40px;
        }
        .replay-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }
        .replay-main, .replay-side { padding: 22px; }
        .replay-main-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .replay-main-id {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .replay-main-id strong {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .replay-head-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .replay-json-link {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 0 12px;
          border: 1px solid var(--gate-border);
          border-radius: 999px;
          background: var(--surface-subtle);
          color: var(--gate-ink);
          font-size: 12px;
          font-weight: 600;
          text-decoration: none;
        }
        .replay-json-link:hover {
          border-color: var(--gate-accent);
          color: var(--gate-accent-strong);
          background: var(--gate-accent-soft);
        }
        .replay-plan {
          margin-top: 14px;
          padding: 14px 16px;
          border: 1px solid var(--gate-border);
          border-radius: 10px;
          background: var(--surface-subtle);
          font-size: 13px;
          line-height: 1.7;
        }
        .replay-plan-row {
          display: grid;
          grid-template-columns: 100px minmax(0, 1fr);
          gap: 10px;
          padding: 4px 0;
        }
        .replay-plan-label {
          color: var(--ink-3);
          font-size: 11px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-weight: 600;
        }
        .replay-plan-meta {
          color: var(--ink-3);
          margin-top: 6px;
          font-size: 11.5px;
        }
        .replay-tools-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          margin: 22px 0 10px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .replay-tools-head .mono {
          font-size: 11px;
          color: var(--ink-3);
        }
        .replay-tools {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .replay-tool-row {
          display: grid;
          grid-template-columns: 22px minmax(0, 1fr);
          gap: 10px;
          align-items: flex-start;
          padding: 10px 12px;
          border: 1px solid var(--border-soft);
          border-radius: 8px;
          background: var(--surface-subtle);
        }
        .replay-tool-icon { margin-top: 2px; }
        .replay-tool-head {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .replay-tool-name {
          font-size: 12px;
          color: var(--gate-accent-strong);
          padding: 1px 6px;
          border-radius: 4px;
          background: var(--gate-accent-soft);
          font-weight: 600;
        }
        .replay-tool-label {
          font-size: 13px;
          color: var(--gate-ink);
        }
        .replay-tool-io {
          display: grid;
          grid-template-columns: 28px minmax(0, 1fr);
          gap: 8px;
          margin-top: 4px;
          font-size: 11.5px;
        }
        .replay-tool-io-key {
          color: var(--ink-3);
          font-weight: 600;
        }
        .replay-tool-io-val {
          color: var(--gate-ink-soft);
          word-break: break-word;
          line-height: 1.55;
        }
        .replay-side {
          position: sticky;
          top: 76px;
        }
        .replay-side-head {
          margin-bottom: 14px;
        }
        .replay-side-head strong {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink-3);
        }
        @media (max-width: 820px) {
          .replay-grid { grid-template-columns: 1fr; }
          .replay-side { position: static; }
        }
      `}</style>
    </div>
  );
}
