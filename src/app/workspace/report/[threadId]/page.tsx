import Link from "next/link";
import { ReportPrintButton } from "@/components/ReportPrintButton";
import { getThreadReport } from "@/lib/workspace/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===== V2.3 处置结果单页面 =====
// 「异常出来之后，要的是一个能报给领导的报告，而不是人一条条去看」——
// 把一次会话的治理产物汇编成可打印/存 PDF 的归档单：批次概览、效能摘要、
// 漂移明细、处置明细、规则引用、决策日志、政策指纹。数据与工作台同源可对账。

const DECISION_LABELS: Record<string, string> = {
  auto_approved: "规则自动处置",
  needs_human: "转人工复核",
  human_approved: "人工采纳",
  human_rejected: "人工驳回",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
};

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  return ts.slice(0, 16).replace("T", " ");
}

function parseKv(json: string): string {
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    return Object.entries(obj)
      .filter(([k]) => k !== "source_hash")
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("/") : String(v)}`)
      .join("；");
  } catch {
    return json;
  }
}

function parseReasons(json: string): string {
  try {
    const arr = JSON.parse(json) as unknown[];
    return arr.map(String).join("、");
  } catch {
    return json;
  }
}

export default async function ThreadReportPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const report = getThreadReport(threadId);
  const thread = report.snapshot.thread;

  if (!report.found || !thread) {
    return (
      <div className="report-page">
        <main className="report-missing">
          <strong>未找到会话 {threadId}</strong>
          <p>该会话可能已被清理，或链接已过期。</p>
          <Link href="/workspace">返回工作台</Link>
        </main>
        <style>{REPORT_CSS}</style>
      </div>
    );
  }

  const { snapshot, metrics, drifts, decisions, rules } = report;
  const dataset = snapshot.dataset;
  const tasks = snapshot.workflowTasks;
  const dispositions = snapshot.dispositionItems;

  const openTasks = tasks.filter((t) => !["已完成", "自动处置", "已驳回"].includes(t.status));
  const doneTasks = tasks.length - openTasks.length;
  const reportNo = `JX-${thread.id.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase()}`;

  return (
    <div className="report-page">
      <main className="report-sheet">
        {/* ===== 头部 ===== */}
        <header className="report-head">
          <div className="report-head-top">
            <div>
              <h1>医药价格治理 · 处置结果单</h1>
              <div className="report-no mono">
                单号 {reportNo} · 生成于 {fmt(report.generatedAt)}
              </div>
            </div>
            <div className="report-actions" data-no-print>
              <ReportPrintButton />
              <Link className="report-back" href="/workspace">
                返回工作台
              </Link>
            </div>
          </div>
          <div className="report-fingerprint mono">
            政策事实指纹 v#{metrics.policyFingerprint ?? "—"}（{metrics.factCount} 条 policy_fact）
            · 会话运行 {report.runCount} 次
            {report.latestOutputHash ? ` · 最近输出指纹 ${report.latestOutputHash.slice(0, 12)}` : ""}
          </div>
        </header>

        {/* ===== 一、批次概览 ===== */}
        <section className="report-section">
          <h2>一、批次概览</h2>
          <dl className="report-meta">
            <div>
              <dt>会话主题</dt>
              <dd>{thread.title || thread.id}</dd>
            </div>
            <div>
              <dt>数据来源</dt>
              <dd>
                {dataset
                  ? `${dataset.title}${dataset.file_name ? `（${dataset.file_name}）` : ""} · ${dataset.row_count} 行`
                  : thread.source_label ?? "—"}
              </dd>
            </div>
            <div>
              <dt>会话状态</dt>
              <dd>{thread.state}</dd>
            </div>
            <div>
              <dt>治理窗口</dt>
              <dd>
                {fmt(thread.created_at)} 至 {fmt(thread.updated_at)}
              </dd>
            </div>
          </dl>
          {Boolean(dataset?.synthetic) && (
            <p className="report-note">
              本单基于合成/脱敏演示数据生成，不构成真实生产处置结论。
            </p>
          )}
        </section>

        {/* ===== 二、治理效能摘要 ===== */}
        <section className="report-section">
          <h2>二、治理效能摘要</h2>
          <div className="report-kpis">
            <div className="kpi">
              <span className="kpi-num">{metrics.totalDecisions}</span>
              <span className="kpi-label">决策留痕</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">{metrics.autoApproved}</span>
              <span className="kpi-label">规则自动处置</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">{metrics.humanApproved + metrics.humanRejected}</span>
              <span className="kpi-label">人工裁决</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">{Math.round(metrics.autoRate * 100)}%</span>
              <span className="kpi-label">自动分流率</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">
                {metrics.driftsResolved}/{metrics.driftsDetected}
              </span>
              <span className="kpi-label">漂移已闭环</span>
            </div>
            <div className="kpi">
              <span className="kpi-num">{metrics.estimatedMinutesSaved}</span>
              <span className="kpi-label">节省人时（分钟）</span>
            </div>
          </div>
          <p className="report-note">{metrics.savingAssumption}。</p>
        </section>

        {/* ===== 三、政策漂移明细 ===== */}
        <section className="report-section">
          <h2>三、政策漂移明细（{drifts.length}）</h2>
          {drifts.length === 0 ? (
            <p className="report-empty">本会话未检出政策漂移。</p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>项目编码</th>
                  <th style={{ width: 130 }}>规则</th>
                  <th style={{ width: 52 }}>级别</th>
                  <th>政策基线 → 观测值</th>
                  <th style={{ width: 64 }}>状态</th>
                  <th style={{ width: 96 }}>检出时间</th>
                </tr>
              </thead>
              <tbody>
                {drifts.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.item_code}</td>
                    <td className="mono">{d.rule_key}</td>
                    <td>
                      <span className={`sev sev-${d.severity}`}>
                        {SEVERITY_LABELS[d.severity] ?? d.severity}
                      </span>
                    </td>
                    <td className="wrap">
                      {parseKv(d.baseline_json)} → {parseKv(d.observed_json)}
                    </td>
                    <td>{d.status}</td>
                    <td className="mono">{fmt(d.detected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ===== 四、处置明细 ===== */}
        <section className="report-section">
          <h2>
            四、处置明细（异常 {dispositions.length} 项 · 流程任务 {tasks.length} 条，其中已办结/自动处置{" "}
            {doneTasks} 条）
          </h2>
          {dispositions.length === 0 ? (
            <p className="report-empty">本会话未生成异常处置项。</p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th>价格项目</th>
                  <th style={{ width: 96 }}>涉及机构</th>
                  <th style={{ width: 150 }}>问题类型</th>
                  <th style={{ width: 52 }}>级别</th>
                  <th style={{ width: 72 }}>状态</th>
                  <th>处置去向</th>
                </tr>
              </thead>
              <tbody>
                {dispositions.map((d) => (
                  <tr key={d.id}>
                    <td className="wrap">{d.item_name}</td>
                    <td>{d.institution_name}</td>
                    <td className="mono">{d.issue_type}</td>
                    <td>
                      <span className={`sev sev-${d.severity}`}>
                        {SEVERITY_LABELS[d.severity] ?? d.severity}
                      </span>
                    </td>
                    <td>{d.status}</td>
                    <td className="wrap">{d.next_action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tasks.length > 0 && (
            <table className="report-table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>流程任务</th>
                  <th style={{ width: 120 }}>类型</th>
                  <th style={{ width: 96 }}>责任岗</th>
                  <th style={{ width: 56 }}>优先级</th>
                  <th style={{ width: 84 }}>状态</th>
                  <th style={{ width: 110 }}>最终动作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="wrap">{t.title}</td>
                    <td>{t.task_type}</td>
                    <td>{t.owner_role}</td>
                    <td>{t.priority}</td>
                    <td>{t.status}</td>
                    <td>{t.final_action ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ===== 五、本单引用的学习规则 ===== */}
        <section className="report-section">
          <h2>五、生效中的学习规则（{rules.length}）</h2>
          {rules.length === 0 ? (
            <p className="report-empty">当前无激活/停用中的学习规则；同类项均转人工复核。</p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>规则</th>
                  <th>触发条件</th>
                  <th>处置动作</th>
                  <th style={{ width: 56 }}>置信度</th>
                  <th style={{ width: 72 }}>支持/命中</th>
                  <th style={{ width: 64 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id.slice(0, 12)}</td>
                    <td className="wrap mono">{parseKv(r.trigger_json)}</td>
                    <td className="wrap mono">{parseKv(r.proposed_action_json)}</td>
                    <td className="mono">{Math.round(r.confidence * 100)}%</td>
                    <td className="mono">
                      {r.support_count}/{r.hit_count}
                    </td>
                    <td>{r.status === "active" ? "激活" : "停用"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="report-note">
            规则由人审决策挖掘沉淀，人工激活后才自动复用；停用立即回到人审。每条规则可回溯至来源决策记录。
          </p>
        </section>

        {/* ===== 六、决策日志 ===== */}
        <section className="report-section">
          <h2>六、决策日志（{decisions.length} 条，全量留痕）</h2>
          {decisions.length === 0 ? (
            <p className="report-empty">本会话暂无决策记录。</p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th style={{ width: 96 }}>时间</th>
                  <th style={{ width: 100 }}>决策</th>
                  <th style={{ width: 96 }}>对象</th>
                  <th>依据</th>
                  <th style={{ width: 130 }}>执行者</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{fmt(d.created_at)}</td>
                    <td>{DECISION_LABELS[d.decision] ?? d.decision}</td>
                    <td className="mono">
                      {d.target_type}
                      <br />
                      {d.target_id.slice(0, 10)}
                    </td>
                    <td className="wrap mono">{parseReasons(d.reason_codes_json)}</td>
                    <td className="mono">
                      {d.actor_type}
                      {d.actor_id ? ` / ${d.actor_id}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ===== 落款 ===== */}
        <footer className="report-foot">
          <div>
            <div className="report-foot-line">编制：价序 · 医药价格治理工作台（人机协同：规则自动处置均可回溯，敏感项均经人工复核）</div>
            <div className="report-foot-line mono">
              对账口径：政策指纹 v#{metrics.policyFingerprint ?? "—"} · 输出指纹{" "}
              {report.latestOutputHash?.slice(0, 12) ?? "—"} · 与工作台数据同源实时生成
            </div>
          </div>
          <div className="report-sign">
            <div>复核人：__________</div>
            <div>日期：__________</div>
          </div>
        </footer>
      </main>
      <style>{REPORT_CSS}</style>
    </div>
  );
}

const REPORT_CSS = `
  .report-page {
    min-height: 100vh;
    background: #eef0f3;
    padding: 28px 16px 60px;
  }
  .report-missing {
    max-width: 560px;
    margin: 80px auto;
    background: #fff;
    border: 1px solid #d9dde3;
    border-radius: 12px;
    padding: 32px;
    text-align: center;
    color: #3d4654;
  }
  .report-missing strong { display: block; font-size: 16px; margin-bottom: 8px; }
  .report-missing a { color: #2563eb; text-decoration: underline; }
  .report-sheet {
    max-width: 940px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid #d9dde3;
    border-radius: 12px;
    padding: 36px 42px 30px;
    color: #1c2430;
    font-size: 13px;
    line-height: 1.6;
  }
  .report-head { border-bottom: 2px solid #1c2430; padding-bottom: 14px; margin-bottom: 20px; }
  .report-head-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .report-head h1 { font-size: 20px; margin: 0 0 6px; letter-spacing: 0.02em; }
  .report-no { font-size: 11.5px; color: #5b6675; }
  .report-fingerprint { margin-top: 8px; font-size: 11px; color: #5b6675; }
  .report-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  .report-print-btn {
    border: 1px solid #1c2430;
    background: #1c2430;
    color: #fff;
    border-radius: 7px;
    padding: 7px 14px;
    font-size: 12.5px;
    cursor: pointer;
  }
  .report-print-btn:hover { opacity: 0.88; }
  .report-back {
    border: 1px solid #c8cdd6;
    border-radius: 7px;
    padding: 7px 12px;
    font-size: 12.5px;
    color: #3d4654;
  }
  .report-back:hover { background: #f3f4f6; }
  .report-section { margin-bottom: 22px; break-inside: avoid; }
  .report-section h2 {
    font-size: 13.5px;
    margin: 0 0 10px;
    padding-left: 8px;
    border-left: 3px solid #1c2430;
    letter-spacing: 0.02em;
  }
  .report-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
    margin: 0;
    border: 1px solid #e2e5ea;
    border-radius: 8px;
    padding: 12px 16px;
    background: #fafbfc;
  }
  .report-meta div { display: grid; grid-template-columns: 76px 1fr; gap: 8px; }
  .report-meta dt { color: #5b6675; font-size: 12px; }
  .report-meta dd { margin: 0; }
  .report-kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .kpi {
    border: 1px solid #e2e5ea;
    border-radius: 8px;
    padding: 10px 8px;
    text-align: center;
    background: #fafbfc;
  }
  .kpi-num { display: block; font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .kpi-label { display: block; font-size: 10.5px; color: #5b6675; margin-top: 3px; }
  .report-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .report-table th, .report-table td {
    border: 1px solid #e2e5ea;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  .report-table th { background: #f3f4f6; font-weight: 600; white-space: nowrap; }
  .report-table td.wrap { word-break: break-all; }
  .report-table .mono, .mono { font-family: var(--font-geist-mono, ui-monospace, SFMono-Regular, monospace); }
  .sev { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600; }
  .sev-critical { background: #fee2e2; color: #b91c1c; }
  .sev-high { background: #ffedd5; color: #c2410c; }
  .sev-medium { background: #fef9c3; color: #a16207; }
  .sev-low { background: #e0f2fe; color: #0369a1; }
  .report-note { font-size: 11px; color: #5b6675; margin: 8px 0 0; }
  .report-empty { font-size: 12px; color: #5b6675; border: 1px dashed #d9dde3; border-radius: 8px; padding: 10px 14px; background: #fafbfc; }
  .report-foot {
    border-top: 2px solid #1c2430;
    margin-top: 26px;
    padding-top: 12px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 24px;
  }
  .report-foot-line { font-size: 11px; color: #5b6675; margin-bottom: 4px; }
  .report-sign { display: flex; gap: 28px; font-size: 12.5px; white-space: nowrap; }
  @media (max-width: 720px) {
    .report-sheet { padding: 22px 18px; }
    .report-kpis { grid-template-columns: repeat(3, 1fr); }
    .report-meta { grid-template-columns: 1fr; }
    .report-foot { flex-direction: column; align-items: flex-start; }
  }
  @media print {
    .report-page { background: #fff; padding: 0; }
    .report-sheet { border: none; border-radius: 0; padding: 0; max-width: none; }
    [data-no-print] { display: none !important; }
    .report-table { font-size: 10px; }
    .sev { border: 1px solid currentColor; background: none !important; }
  }
`;
