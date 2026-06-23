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
      <AppHeader active="数据通行" />
      <Breadcrumb items={["数据通行", "数据集发布", id, "审批记录"]} />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "12px 24px 40px" }}>
        <ResultTabs releaseId={id} active="approval" />

        {approvals.length === 0 ? (
          <div className="gate-card" style={{ padding: 40, textAlign: "center" }}>
            <p style={{ marginBottom: 8 }}>本批次最近一次运行没有产生审批对象。</p>
            <p style={{ color: "var(--gate-ink-soft)", marginBottom: 18 }}>
              身份冲突或权限拒绝会进入「需审批」并生成审批对象。
            </p>
            <Link href={`/release/${id}`} style={{ color: "var(--gate-accent)", fontWeight: 600 }}>
              运行「身份冲突 / 权限拒绝」变更试试 →
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
              <div key={a.id} className="gate-card" style={{ padding: 22, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Badge className="mono" variant="soft" color="gray">{a.id}</Badge>
                    <Badge
                      color={a.status === "approved" ? "green" : a.status === "rejected" ? "red" : "orange"}
                      variant="soft"
                    >
                      {a.status === "approved" ? "已批准" : a.status === "rejected" ? "已拒绝" : "待审批"}
                    </Badge>
                  </div>
                  {release && <StateBadge state={release.state} />}
                </div>

                <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6 }}>{a.reason}</p>

                {policy && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--gate-ink-soft)" }}>
                      访问策略快照（审批依据）
                    </summary>
                    <pre className="mono" style={{ fontSize: 11.5, background: "#f6f8fc", padding: 12, borderRadius: 8, overflowX: "auto", marginTop: 8 }}>
                      {JSON.stringify(policy, null, 2)}
                    </pre>
                  </details>
                )}

                {a.status === "pending" ? (
                  <ApprovalActions approvalId={a.id} />
                ) : (
                  <div style={{ marginTop: 12, fontSize: 13, color: "var(--gate-ink-soft)", lineHeight: 1.7 }}>
                    审批人：{a.approver} · 时间：{a.decided_at?.slice(0, 19).replace("T", " ")}
                    <br />
                    备注：{a.human_notes || "（无）"}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
