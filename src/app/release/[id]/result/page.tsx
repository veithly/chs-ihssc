import Link from "next/link";
import { Badge, Callout } from "@radix-ui/themes";
import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
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
  getRows,
} from "@/lib/repo";
import { infoFor } from "@/lib/issueInfo";
import { CODE_ALIASES, PRICE_CATALOG, warningTierFor } from "@/lib/fixtures";
import type { AgentPlan, BatchStats, ReplayEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISSUE_TYPE_LABEL: Record<string, string> = {
  date_anomaly: "价格日期异常",
  item_catalog_miss: "项目未命中目录",
  item_code_correctable: "项目编码可标化",
  item_name_mismatch: "名称不一致",
  price_invalid: "单价格式异常",
  price_over_ceiling: "超过最高有效价",
  collective_price_overrun: "集采价超阈值",
  collective_not_landed: "集采未落地",
  procurement_channel_unknown: "未知采购渠道",
  price_spike: "参考价涨幅异常",
  schema_field_missing: "字段缺失",
  retail_over_1p3x: "超零售集中价1.3倍",
  retail_price_no_code: "零售价无编码可对应",
  retail_price_unmatched: "零售价无编码未对应",
  spec_over_ratio: "差比价折算超限",
};

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
        <AppHeader active="价格治理" />
        <main className="result-empty">未找到价格批次 {id}</main>
      </div>
    );
  }

  const run = getLatestRun(id);

  return (
    <div className="gate-shell">
      <AppHeader active="价格治理" />
      <Breadcrumb items={["价格治理", "价格批次", release.id, "结果"]} />
      <main className="result-shell">
        <ResultTabs releaseId={id} active="result" />

        {!run ? (
          <div className="gate-card result-empty-card">
            <p className="result-empty-title">该批次尚未发起价格治理核查。</p>
            <p className="result-empty-lead">
              回到价格治理工作台，对整批价格明细发起一次核查。
            </p>
            <Link href={`/release/${id}`} className="cta-primary" style={{ maxWidth: 240 }}>
              前往价格治理
            </Link>
          </div>
        ) : (
          <ResultBody release={release} run={run} />
        )}
      </main>
    </div>
  );
}

function ResultBody({
  release,
  run,
}: {
  release: NonNullable<ReturnType<typeof getRelease>>;
  run: NonNullable<ReturnType<typeof getLatestRun>>;
}) {
  const plan = JSON.parse(run.plan_json) as AgentPlan;
  const events = JSON.parse(getReplayByRun(run.id)?.events_json ?? "[]") as ReplayEvent[];
  const issues = getIssuesByRun(run.id);
  const corrections = getCorrectionsByRun(run.id);
  const quarantine = getQuarantineByRun(run.id);
  const approvals = getApprovalsByRun(run.id);
  const stats = JSON.parse(run.candidate_json || "{}") as Partial<BatchStats>;
  const degraded = run.status !== "success";

  const byState = stats.by_state ?? { 可落地: 0, 纠错候选: 0, 异常处置: 0, 需核验: 0 };
  const byType = stats.by_issue_type ?? {};

  const distCards = [
    { label: "异常处置", value: byState["异常处置"] ?? 0, color: "var(--gate-red)" },
    { label: "需核验", value: byState["需核验"] ?? 0, color: "var(--gate-amber)" },
    { label: "纠错候选", value: byState["纠错候选"] ?? 0, color: "var(--gate-violet)" },
    { label: "可落地", value: byState["可落地"] ?? 0, color: "var(--gate-green)" },
  ];

  return (
    <div className="result-grid">
      <section className="gate-card result-main fade-in">
        <div className="result-main-head">
          <div className="result-main-id">
            <span className="result-main-kicker mono">本次核查 · 价格治理批次</span>
            <span className="mono result-main-id-text">{run.release_id}</span>
          </div>
          <StateBadge state={run.result_state} size="3" />
        </div>

        {degraded ? (
          <Callout.Root color="gray" style={{ marginTop: 16 }}>
            <Callout.Icon><CrossCircledIcon /></Callout.Icon>
            <Callout.Text>
              <strong>检查不可执行（{run.error_category}）。</strong> 智能研判配置不可用，已写入「检查失败」并保留过程记录，未输出任何伪造结论。请在
              <Link href="/settings" style={{ color: "var(--gate-accent)" }}> 设置 </Link>
              确认配置后，回到
              <Link href={`/release/${run.release_id}`} style={{ color: "var(--gate-accent)" }}> 价格治理 </Link>
              重试。
            </Callout.Text>
          </Callout.Root>
        ) : (
          <div className="result-summary">
            <CheckCircledIcon color="var(--gate-green)" width={20} height={20} />
            <div>
              <div className="result-summary-line">
                扫描 <strong className="mono">{stats.scanned ?? 0}</strong> 行 · 命中{" "}
                <strong className="mono">{stats.issues ?? 0}</strong> 处问题 ·{" "}
                <strong className="mono">{stats.validations ?? 0}</strong> 次规则校验
              </div>
              <div className="mono result-summary-meta">
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
            <div className="result-section-head">问题分布</div>
            <div className="dist-grid">
              {distCards.map((c) => (
                <div key={c.label} className="dist-card">
                  <div className="dist-num" style={{ color: c.color }}>{c.value}</div>
                  <div className="dist-label">{c.label}</div>
                </div>
              ))}
            </div>

            {Object.keys(byType).length > 0 && (
              <div className="result-issue-badges">
                {Object.entries(byType).map(([t, n]) => (
                  <Badge key={t} variant="soft" color="gray" size="2" radius="full">
                    {ISSUE_TYPE_LABEL[t] ?? t} · {n}
                  </Badge>
                ))}
              </div>
            )}

            <div className="result-nav-chips">
              <Link href={`/release/${run.release_id}/approval`} className="chip" style={{ minHeight: 38 }}>
                待核验 {approvals.length}
              </Link>
              <Link href="/queue" className="chip" style={{ minHeight: 38 }}>
                异常处置 {quarantine.length}
              </Link>
              <span className="chip" style={{ minHeight: 38, cursor: "default" }}>
                纠错提案 {corrections.length}
              </span>
            </div>

            <div className="result-section-head">
              受影响记录
              <span className="mono" style={{ color: "var(--ink-3)", fontWeight: 500, marginLeft: 6 }}>
                {issues.length} 条
              </span>
            </div>
            <div className="batch-scroll" style={{ maxHeight: 320 }}>
              <table className="batch-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>项目编码</th>
                    <th>药品 / 耗材名称</th>
                    <th>地区</th>
                    <th>单价</th>
                    <th>价格日期</th>
                    <th>问题</th>
                    <th>置信度</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((iss) => {
                    const r = getRows(run.release_id).find((row) => row.row_index === iss.row_index);
                    const fields = (() => {
                      try {
                        return JSON.parse(iss.detected_fields) as string[];
                      } catch {
                        return [];
                      }
                    })();
                    const info = infoFor(iss.type);
                    const kindColor =
                      info.kind === "处置" ? "red" : info.kind === "核验" ? "amber" : info.kind === "纠错" ? "violet" : "green";
                    // 苏医保发〔2021〕64号红黄预警分档徽标（超最高有效价行按倍数分档）
                    const tier = (() => {
                      if (iss.type !== "price_over_ceiling" || !r) return null;
                      const code = PRICE_CATALOG[r.item_code] ? r.item_code : CODE_ALIASES[r.item_code];
                      const item = code ? PRICE_CATALOG[code] : null;
                      const price = Number(String(r.unit_price).replace(/[,\s元]/g, ""));
                      if (!item || !Number.isFinite(price) || price <= 0) return null;
                      return warningTierFor(price / item.ceilingPrice);
                    })();
                    return (
                      <tr key={iss.id}>
                        <td className="mono" style={{ color: "var(--gate-ink-soft)" }}>{iss.row_index + 1}</td>
                        <td className="mono" style={{ color: fields.includes("item_code") ? "var(--gate-red)" : undefined }}>
                          {r?.item_code ?? "-"}
                        </td>
                        <td style={{ color: fields.includes("item_name") ? "var(--gate-red)" : undefined }}>
                          {r?.item_name || "（空）"}
                        </td>
                        <td style={{ color: fields.includes("region") ? "var(--gate-red)" : undefined }}>
                          {r?.region ?? "-"}
                        </td>
                        <td className="mono" style={{ color: fields.includes("unit_price") ? "var(--gate-red)" : undefined }}>
                          {r?.unit_price ?? "-"}
                        </td>
                        <td className="mono" style={{ color: fields.includes("price_date") ? "var(--gate-red)" : undefined }}>
                          {r?.price_date ?? "-"}
                        </td>
                        <td>
                          <Badge variant="soft" color={kindColor} size="1" radius="full">
                            {ISSUE_TYPE_LABEL[iss.type] ?? info.title}
                          </Badge>
                          {tier && (
                            <Badge
                              variant="solid"
                              color={tier.color === "red" ? "red" : "amber"}
                              size="1"
                              radius="full"
                              title={`苏医保发〔2021〕64号：${tier.action}`}
                              style={{ marginLeft: 6 }}
                            >
                              {tier.label}
                            </Badge>
                          )}
                        </td>
                        <td className="mono" style={{ color: "var(--gate-ink-soft)" }}>
                          {iss.confidence.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                  {issues.length === 0 && (
                    <tr>
                      <td colSpan={8} className="result-empty-row">
                        全部 {stats.scanned ?? 0} 行可落地，无受影响价格记录。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <aside className="gate-card result-aside fade-in">
        <div className="result-aside-head">
          <strong>核查过程</strong>
          <Badge variant="soft" color="gray" className="mono" radius="full">{run.id.slice(0, 14)}</Badge>
        </div>
        <ReplayTimelineView events={events} />
        <div className="result-aside-foot">
          <Link href={`/release/${run.release_id}/replay`} className="result-aside-link">
            查看完整过程 →
          </Link>
        </div>
        <div className="result-aside-meta mono">
          研判状态 · {plan.source === "live-provider" ? "已接通" : "仅保留可确定结果"}
          <br />
          核查重点 · {plan.issue_focus}
        </div>
      </aside>
    </div>
  );
}
