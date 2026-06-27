import Link from "next/link";
import { Badge } from "@radix-ui/themes";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ResultTabs } from "@/components/ResultTabs";
import { ApprovalActions } from "@/components/ClientButtons";
import { StateBadge } from "@/components/StateBadge";
import {
  getApprovalsByRun,
  getLatestRun,
  getRelease,
} from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const release = getRelease(id);
  const run = release ? getLatestRun(id) : null;
  const approvals = run ? getApprovalsByRun(run.id) : [];

  return (
    <div className="gate-shell">
      <AppHeader active="价格治理" />
      <Breadcrumb items={["价格治理", "价格批次", id, "核验记录"]} />
      <main className="approval-shell">
        <ResultTabs releaseId={id} active="approval" />

        {approvals.length === 0 ? (
          <div className="gate-card approval-empty">
            <p className="approval-empty-title">本批次最近一次运行没有产生核验对象。</p>
            <p className="approval-empty-lead">
              集采未落地、参考价涨幅异常或未知渠道会进入「需核验」并生成核验对象。
            </p>
            <Link href={`/release/${id}`} className="approval-empty-link">
              运行价格治理试试 →
            </Link>
          </div>
        ) : (
          approvals.map((a) => {
            const policy = (() => {
              try {
                return JSON.parse(a.policy_snapshot);
              } catch {
                return null;
              }
            })();
            return (
              <div key={a.id} className="gate-card approval-card">
                <div className="approval-card-head">
                  <div className="approval-card-id">
                    <Badge className="mono" variant="soft" color="gray" radius="full">{a.id}</Badge>
                    <Badge
                      color={a.status === "approved" ? "green" : a.status === "rejected" ? "red" : "orange"}
                      variant="soft"
                      radius="full"
                    >
                      {a.status === "approved" ? "已确认" : a.status === "rejected" ? "转处置" : "待核验"}
                    </Badge>
                  </div>
                  {release && <StateBadge state={release.state} />}
                </div>

                <p className="approval-reason">{a.reason}</p>

                {policy && (
                  <details className="approval-details">
                    <summary>采购渠道策略快照（核验依据）</summary>
                    <pre className="mono approval-pre">
                      {JSON.stringify(policy, null, 2)}
                    </pre>
                  </details>
                )}

                {a.status === "pending" ? (
                  <ApprovalActions approvalId={a.id} />
                ) : (
                  <div className="approval-decided">
                    <div>
                      <span className="approval-meta-label">核验人</span>
                      <span>{a.approver}</span>
                    </div>
                    <div>
                      <span className="approval-meta-label">时间</span>
                      <span className="mono">{a.decided_at?.slice(0, 19).replace("T", " ")}</span>
                    </div>
                    <div>
                      <span className="approval-meta-label">备注</span>
                      <span>{a.human_notes || "（无）"}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>
      <style>{`
        .approval-shell {
          max-width: 920px;
          margin: 0 auto;
          padding: 14px 24px 40px;
        }
        .approval-empty { padding: 44px; text-align: center; }
        .approval-empty-title {
          margin: 0 0 6px;
          font-size: 15px;
          font-weight: 600;
          color: var(--gate-ink);
        }
        .approval-empty-lead {
          color: var(--gate-ink-soft);
          margin: 0 0 18px;
          font-size: 13px;
          line-height: 1.6;
        }
        .approval-empty-link {
          color: var(--gate-accent);
          font-weight: 600;
          font-size: 13.5px;
        }
        .approval-card {
          padding: 22px;
          margin-bottom: 14px;
        }
        .approval-card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .approval-card-id {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .approval-reason {
          margin: 14px 0 0;
          font-size: 14px;
          line-height: 1.65;
          color: var(--gate-ink);
        }
        .approval-details {
          margin-top: 12px;
        }
        .approval-details summary {
          cursor: pointer;
          font-size: 12.5px;
          color: var(--ink-3);
          font-weight: 500;
          user-select: none;
        }
        .approval-pre {
          font-size: 11.5px;
          background: var(--surface-sunken);
          padding: 12px;
          border-radius: 8px;
          overflow-x: auto;
          margin-top: 8px;
          color: var(--gate-ink);
          border: 1px solid var(--border-soft);
        }
        .approval-decided {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-soft);
          font-size: 13px;
          color: var(--gate-ink-soft);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .approval-decided > div {
          display: flex;
          gap: 8px;
        }
        .approval-meta-label {
          min-width: 60px;
          color: var(--ink-3);
          font-size: 11px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
