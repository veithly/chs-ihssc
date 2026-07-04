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
      <AppHeader active="待办核验" />
      <Breadcrumb items={["价序", "核验队列"]} />
      <main className="queue-shell">
        <header className="queue-head">
          <div>
            <div className="agent-eyebrow"><span className="mono">价序 · 核验队列</span></div>
            <h1 className="queue-title">核验队列</h1>
            <p className="queue-lead">
              晨会排出的线索会在这里沉淀成待核验、待补证和异常处置对象。
            </p>
          </div>
          <ResetSampleButton />
        </header>

        <div className="queue-grid">
          <section className="gate-card queue-card">
            <div className="queue-card-head">
              <strong>价格来源批次</strong>
              <span className="mono queue-card-count">{releases.length}</span>
            </div>
            <div className="queue-list">
              {releases.map((r) => (
                <Link
                  key={r.id}
                  href={`/release/${r.id}`}
                  className="queue-row"
                >
                  <span className="queue-row-id">
                    <span className="mono">{r.id}</span>
                    <span className="queue-row-title">{r.title}</span>
                    {r.is_sample === 1 && (
                      <Badge color="gray" variant="soft" size="1" radius="full">样例</Badge>
                    )}
                  </span>
                  <StateBadge state={r.state} />
                </Link>
              ))}
              {releases.length === 0 && (
                <p className="queue-empty">暂无价格来源批次。</p>
              )}
            </div>
          </section>

          <div className="queue-side">
            <section className="gate-card queue-card">
              <div className="queue-card-head">
                <strong>待核验</strong>
                <span className="mono queue-card-count">{approvals.length}</span>
              </div>
              <div className="queue-list">
                {approvals.length === 0 && <p className="queue-empty">暂无待核验项。</p>}
                {approvals.map((a) => (
                  <Link key={a.id} href={`/release/${a.release_id}/approval`} className="queue-row queue-row-stack">
                    <div className="queue-row-head">
                      <span className="mono queue-row-id-text">{a.release_id}</span>
                      <Badge color="orange" variant="soft" size="1" radius="full">需核验</Badge>
                    </div>
                    <div className="queue-row-reason">{a.reason}</div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="gate-card queue-card">
              <div className="queue-card-head">
                <strong>异常处置待确认</strong>
                <span className="mono queue-card-count">{quarantine.length}</span>
              </div>
              <div className="queue-list">
                {quarantine.length === 0 && <p className="queue-empty">暂无异常处置项。</p>}
                {quarantine.map((q) => (
                  <Link key={q.id} href={`/release/${q.release_id}/result`} className="queue-row queue-row-stack">
                    <div className="queue-row-head">
                      <span className="mono queue-row-id-text">{q.release_id}</span>
                      <Badge color="red" variant="soft" size="1" radius="full">异常处置</Badge>
                    </div>
                    <div className="queue-row-reason">{q.reason}</div>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
