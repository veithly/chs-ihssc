import Link from "next/link";
import { Badge, Callout } from "@radix-ui/themes";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
} from "@radix-ui/react-icons";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ResultTabs } from "@/components/ResultTabs";
import { StateBadge } from "@/components/StateBadge";
import { MetaGrid } from "@/components/MetaGrid";
import { ReplayTimelineView } from "@/components/ReplayTimelineView";
import {
  getApprovalsByRun,
  getCorrectionsByRun,
  getIssuesByRun,
  getLatestRun,
  getQuarantineByRun,
  getRelease,
  getReplayByRun,
} from "@/lib/repo";
import { infoFor } from "@/lib/issueInfo";
import type { AgentPlan, ReplayEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const release = getRelease(id);
  if (!release) {
    return (
      <div className="gate-shell">
        <AppHeader active="数据通行" />
        <div style={{ maxWidth: 720, margin: "60px auto", textAlign: "center" }}>
          未找到发布批次 {id}
        </div>
      </div>
    );
  }

  const run = getLatestRun(id);

  return (
    <div className="gate-shell">
      <AppHeader active="数据通行" />
      <Breadcrumb items={["数据通行", "数据集发布", release.id, "结果"]} />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "12px 24px 40px" }}>
        <ResultTabs releaseId={id} active="result" />

        {!run ? (
          <div className="gate-card" style={{ padding: 40, textAlign: "center" }}>
            <p style={{ fontSize: 16, marginBottom: 8 }}>该批次尚未运行通行检查。</p>
            <p style={{ color: "var(--gate-ink-soft)", marginBottom: 20 }}>
              回到通行检查工作台，选择一个变更类型并运行通行检查。
            </p>
            <Link href={`/release/${id}`} className="cta-primary" style={{ maxWidth: 240, margin: "0 auto" }}>
              前往通行检查
            </Link>
          </div>
        ) : (
          <ResultBody release={release} run={run} />
        )}
      </div>
    </div>
  );
}

function ResultBody({
  release,
  run,
}: {
  release: ReturnType<typeof getRelease> & object;
  run: NonNullable<ReturnType<typeof getLatestRun>>;
}) {
  const plan = JSON.parse(run.plan_json) as AgentPlan;
  const events = (
    JSON.parse(getReplayByRun(run.id)?.events_json ?? "[]") as ReplayEvent[]
  );
  const issues = getIssuesByRun(run.id);
  const corrections = getCorrectionsByRun(run.id);
  const quarantine = getQuarantineByRun(run.id);
  const approvals = getApprovalsByRun(run.id);
  const candidate = JSON.parse(run.candidate_json || "{}") as {
    row_index?: number;
    person_token?: string;
    catalog_code?: string;
    service_date?: string;
    access_policy?: string;
  };
  const degraded = run.status !== "success";
  const issue = issues[0];
  const info = infoFor(issue?.type ?? "");

  const detailText =
    quarantine[0]?.reason ??
    approvals[0]?.reason ??
    (corrections[0]
      ? `字典高置信纠错：${corrections[0].before_value} → ${corrections[0].after_value}`
      : "未发现阻断性问题。");

  return (
    <div
      className="result-grid"
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.55fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}
    >
      <section className="gate-card fade-in" style={{ padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 13, color: "var(--gate-ink-soft)" }}>数据集发布</span>
            <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{run.release_id}</span>
          </div>
          <StateBadge state={run.result_state} size="3" />
        </div>

        {degraded ? (
          <Callout.Root color="gray" style={{ marginTop: 16 }}>
            <Callout.Icon><CrossCircledIcon /></Callout.Icon>
            <Callout.Text>
              <strong>检查不可执行（{run.error_category}）。</strong> Provider/凭证不可用，已写入「检查失败」并保留可回放降级记录，未输出任何伪造结论。请在
              <Link href="/settings" style={{ color: "var(--gate-accent)" }}> 设置 </Link>
              确认凭证后，回到
              <Link href={`/release/${run.release_id}`} style={{ color: "var(--gate-accent)" }}> 通行检查 </Link>
              重试。
            </Callout.Text>
          </Callout.Root>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 16,
              padding: "12px 14px",
              background: "var(--gate-green-soft)",
              border: "1px solid #cdeBd8",
              borderRadius: 10,
            }}
          >
            <CheckCircledIcon color="var(--gate-green)" width={20} height={20} />
            <div style={{ fontSize: 13.5 }}>
              <div style={{ fontWeight: 600 }}>运行完成，状态已写入</div>
              <div className="mono" style={{ color: "var(--gate-ink-soft)", marginTop: 2 }}>
                {run.id} · {run.finished_at.slice(0, 19).replace("T", " ")} · {run.duration_ms}ms
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <MetaGrid release={release as never} />
        </div>

        {!degraded && (
          <>
            <strong style={{ display: "block", fontSize: 15, margin: "22px 0 10px" }}>运行结果摘要</strong>
            <div className="gate-card-flat">
              {[
                { icon: "❗", label: "行问题", value: issue ? `第 ${issue.row_index + 1} 行：${info.title}` : "无" },
                { icon: "💡", label: "处理建议", value: info.recommend },
                {
                  icon: info.kind === "纠错" ? "✎" : info.kind === "审批" ? "⚖" : "⛔",
                  label: info.kind === "纠错" ? "纠错说明" : info.kind === "审批" ? "审批原因" : "隔离原因",
                  value: detailText,
                },
                { icon: "→", label: "下一步", value: info.next },
              ].map((r, i) => (
                <div
                  key={r.label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "92px 1fr",
                    gap: 12,
                    padding: "12px 14px",
                    borderTop: i === 0 ? "none" : "1px solid var(--gate-border)",
                    fontSize: 13.5,
                  }}
                >
                  <span style={{ color: "var(--gate-ink-soft)" }}>{r.icon} {r.label}</span>
                  <span style={{ lineHeight: 1.55 }}>{r.value}</span>
                </div>
              ))}
            </div>

            <strong style={{ display: "block", fontSize: 15, margin: "22px 0 10px" }}>
              受影响记录（{issues.length} 条）
            </strong>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "var(--gate-ink-soft)", textAlign: "left" }}>
                    <th style={{ padding: "9px 10px", fontWeight: 500 }}>行号</th>
                    <th style={{ padding: "9px 10px", fontWeight: 500 }}>人员标识</th>
                    <th style={{ padding: "9px 10px", fontWeight: 500 }}>病种编码</th>
                    <th style={{ padding: "9px 10px", fontWeight: 500 }}>服务日期</th>
                    <th style={{ padding: "9px 10px", fontWeight: 500 }}>访问策略</th>
                    <th style={{ padding: "9px 10px", fontWeight: 500 }}>问题</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderTop: "1px solid var(--gate-border)" }}>
                    <td className="mono" style={{ padding: "11px 10px" }}>{(candidate.row_index ?? 0) + 1}</td>
                    <td className="mono" style={{ padding: "11px 10px" }}>{candidate.person_token}</td>
                    <td className="mono" style={{ padding: "11px 10px", color: issue?.detected_fields?.includes("catalog_code") ? "var(--gate-red)" : undefined }}>{candidate.catalog_code}</td>
                    <td className="mono" style={{ padding: "11px 10px", color: issue?.detected_fields?.includes("service_date") ? "var(--gate-red)" : undefined }}>{candidate.service_date}</td>
                    <td style={{ padding: "11px 10px", color: "var(--gate-ink-soft)" }}>{candidate.access_policy}</td>
                    <td style={{ padding: "11px 10px" }}>{info.title}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* RIGHT: run timeline */}
      <aside className="gate-card fade-in" style={{ padding: 22, position: "sticky", top: 76 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <strong style={{ fontSize: 15 }}>运行时间线</strong>
          <Badge variant="soft" color="gray" className="mono">{run.id}</Badge>
        </div>
        <ReplayTimelineView events={events} />
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--gate-border)" }}>
          <Link href={`/release/${run.release_id}/replay`} style={{ color: "var(--gate-accent)", fontSize: 14, fontWeight: 600 }}>
            查看完整执行日志 →
          </Link>
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--gate-ink-soft)", lineHeight: 1.6 }}>
          Provider：{plan.source === "live-provider" ? "live" : "降级"} · 计划重点：{plan.issue_focus}
        </div>
      </aside>
    </div>
  );
}
