import Link from "next/link";
import { Badge } from "@radix-ui/themes";
import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ResultTabs } from "@/components/ResultTabs";
import { ReplayTimelineView } from "@/components/ReplayTimelineView";
import { StateBadge } from "@/components/StateBadge";
import { CopyButton } from "@/components/ClientButtons";
import { getLatestRun, getRelease, getReplayByRun } from "@/lib/repo";
import type { AgentPlan, ReplayEvent, ToolCall } from "@/lib/types";

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
      <AppHeader active="数据通行" />
      <Breadcrumb items={["数据通行", "数据集发布", id, "运行回放"]} />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "12px 24px 40px" }}>
        <ResultTabs releaseId={id} active="replay" />
        {!run ? (
          <EmptyReplay id={id} />
        ) : (
          <ReplayBody id={id} run={run} />
        )}
      </div>
    </div>
  );
}

function EmptyReplay({ id }: { id: string }) {
  return (
    <div className="gate-card" style={{ padding: 40, textAlign: "center" }}>
      <p style={{ marginBottom: 16 }}>暂无运行回放。先运行一次通行检查。</p>
      <Link href={`/release/${id}`} style={{ color: "var(--gate-accent)", fontWeight: 600 }}>
        前往通行检查 →
      </Link>
    </div>
  );
}

function ReplayBody({ id, run }: { id: string; run: NonNullable<ReturnType<typeof getLatestRun>> }) {
  const plan = JSON.parse(run.plan_json) as AgentPlan;
  const tools = JSON.parse(run.tools_json) as ToolCall[];
  const meta = JSON.parse(run.provider_meta_json) as Record<string, unknown>;
  const events = JSON.parse(getReplayByRun(run.id)?.events_json ?? "[]") as ReplayEvent[];

  return (
    <div
      className="result-grid"
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.55fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}
    >
      <section className="gate-card" style={{ padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ fontSize: 15 }}>Agent 计划与工具调用</strong>
            <Badge className="mono" variant="soft" color="gray">{run.id}</Badge>
            <StateBadge state={run.result_state} />
          </div>
          <CopyButton text={`/release/${id}/replay`} />
        </div>

        <div className="gate-card-flat" style={{ padding: 14, marginTop: 14, fontSize: 13.5, lineHeight: 1.7 }}>
          <div><span style={{ color: "var(--gate-ink-soft)" }}>计划重点：</span><strong>{plan.issue_focus}</strong></div>
          <div><span style={{ color: "var(--gate-ink-soft)" }}>预计状态：</span>{plan.expected_state}</div>
          <div><span style={{ color: "var(--gate-ink-soft)" }}>规划说明（live provider）：</span>{plan.rationale}</div>
          <div className="mono" style={{ color: "var(--gate-ink-soft)", marginTop: 6, fontSize: 12.5 }}>
            provider={String(meta.source)} · model={String(meta.model ?? "-")} · host={String(meta.baseUrlHost ?? "-")} · {String(meta.latency_ms ?? "-")}ms
          </div>
        </div>

        <strong style={{ display: "block", fontSize: 14, margin: "20px 0 10px" }}>
          工具调用轨迹（{tools.length} 次）
        </strong>
        <div data-tool-trace style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tools.map((t, i) => (
            <div
              key={i}
              className="gate-card-flat"
              style={{ padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}
            >
              <span style={{ marginTop: 2 }}>
                {t.ok ? (
                  <CheckCircledIcon color="var(--gate-green)" />
                ) : (
                  <CrossCircledIcon color="var(--gate-amber)" />
                )}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <code className="mono" style={{ fontSize: 12.5, color: "var(--gate-accent)" }}>{t.tool}</code>
                  <span style={{ fontSize: 13 }}>{t.label}</span>
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--gate-ink-soft)", marginTop: 3 }}>
                  in: {t.input}
                </div>
                <div style={{ fontSize: 12.5, marginTop: 2 }}>out: {t.output}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="gate-card" style={{ padding: 22, position: "sticky", top: 76 }}>
        <strong style={{ fontSize: 15, display: "block", marginBottom: 16 }}>
          observe / plan / tools / mutate / verify
        </strong>
        <ReplayTimelineView events={events} />
      </aside>
    </div>
  );
}
