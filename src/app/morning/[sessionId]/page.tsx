import Link from "next/link";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { MorningSessionPanel } from "@/components/MorningWorkbench";
import { getMorningSession, getReplayBySession, listDailyLeads } from "@/lib/repo";
import type { ReplayEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MorningSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = getMorningSession(sessionId);

  if (!session) {
    return (
      <div className="gate-shell">
        <AppHeader active="价格晨会" />
        <main className="morning-empty">
          <h1>未找到晨会：{sessionId}</h1>
          <p>
            返回{" "}
            <Link href="/morning" className="morning-empty-link">
              今日价格处置晨会
            </Link>{" "}
            重新打开。
          </p>
        </main>
        <style>{`
          .morning-empty {
            max-width: 760px;
            margin: 80px auto;
            padding: 24px;
            text-align: center;
          }
          .morning-empty h1 {
            font-size: 22px;
            font-weight: 600;
            letter-spacing: -0.02em;
            color: var(--gate-ink);
            margin: 0 0 8px;
          }
          .morning-empty p {
            color: var(--gate-ink-soft);
            font-size: 13.5px;
            margin: 0;
          }
          .morning-empty-link {
            color: var(--gate-accent);
            font-weight: 600;
          }
        `}</style>
      </div>
    );
  }

  const leads = listDailyLeads(session.id);
  const replay = JSON.parse(getReplayBySession(session.id)?.events_json ?? "[]") as ReplayEvent[];

  return (
    <div className="gate-shell">
      <AppHeader active="价格晨会" />
      <Breadcrumb items={["价序", "价格晨会", session.session_date, session.id]} />
      <main className="morning-session-shell">
        <MorningSessionPanel session={plain(session)} leads={plain(leads)} replay={plain(replay)} />
      </main>
      <style>{`
        .morning-session-shell {
          max-width: 1320px;
          margin: 0 auto;
          padding: 14px 24px 44px;
        }
        @media (max-width: 820px) {
          .morning-session-shell { padding: 12px 14px 32px; }
        }
      `}</style>
    </div>
  );
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
