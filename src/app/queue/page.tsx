import Link from "next/link";
import { Badge } from "@radix-ui/themes";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { StateBadge } from "@/components/StateBadge";
import { ResetSampleButton } from "@/components/ClientButtons";
import {
  listPendingApprovals,
  listQuarantine,
  listReleases,
} from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const releases = listReleases();
  const approvals = listPendingApprovals();
  const quarantine = listQuarantine();

  return (
    <div className="gate-shell">
      <AppHeader active="队列" />
      <Breadcrumb items={["数据通行", "队列"]} />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "12px 24px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, margin: 0 }}>发布 / 隔离 / 审批队列</h1>
            <p style={{ color: "var(--gate-ink-soft)", fontSize: 13.5, marginTop: 4 }}>
              运营人员的回访工作台：处理每批待发布数据、待审批与隔离记录。
            </p>
          </div>
          <ResetSampleButton />
        </div>

        <div className="result-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20, alignItems: "start" }}>
          <section className="gate-card" style={{ padding: 22 }}>
            <strong style={{ fontSize: 15 }}>发布批次</strong>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {releases.map((r) => (
                <Link
                  key={r.id}
                  href={`/release/${r.id}`}
                  className="gate-card-flat"
                  style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span>
                    <span className="mono" style={{ fontWeight: 600 }}>{r.id}</span>
                    <span style={{ color: "var(--gate-ink-soft)", fontSize: 13, marginLeft: 10 }}>{r.title}</span>
                    {r.is_sample === 1 && <Badge color="gray" variant="soft" size="1" style={{ marginLeft: 8 }}>样例</Badge>}
                  </span>
                  <StateBadge state={r.state} />
                </Link>
              ))}
            </div>
          </section>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <section className="gate-card" style={{ padding: 22 }}>
              <strong style={{ fontSize: 15 }}>待审批（{approvals.length}）</strong>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {approvals.length === 0 && <p style={{ color: "var(--gate-ink-soft)", fontSize: 13 }}>暂无待审批项。</p>}
                {approvals.map((a) => (
                  <Link key={a.id} href={`/release/${a.release_id}/approval`} className="gate-card-flat" style={{ padding: "11px 13px", fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="mono" style={{ color: "var(--gate-accent)" }}>{a.release_id}</span>
                      <Badge color="orange" variant="soft" size="1">需审批</Badge>
                    </div>
                    <div style={{ color: "var(--gate-ink-soft)", marginTop: 4, lineHeight: 1.5 }}>{a.reason}</div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="gate-card" style={{ padding: 22 }}>
              <strong style={{ fontSize: 15 }}>隔离项（{quarantine.length}）</strong>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {quarantine.length === 0 && <p style={{ color: "var(--gate-ink-soft)", fontSize: 13 }}>暂无隔离项。</p>}
                {quarantine.map((q) => (
                  <Link key={q.id} href={`/release/${q.release_id}/result`} className="gate-card-flat" style={{ padding: "11px 13px", fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="mono" style={{ color: "var(--gate-accent)" }}>{q.release_id}</span>
                      <Badge color="red" variant="soft" size="1">隔离</Badge>
                    </div>
                    <div style={{ color: "var(--gate-ink-soft)", marginTop: 4, lineHeight: 1.5 }}>{q.reason}</div>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
