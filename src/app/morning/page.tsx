import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { MorningOpenPanel } from "@/components/MorningWorkbench";
import { getTodayMorningSession, listMorningSessions } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function MorningPage() {
  const today = getTodayMorningSession();
  const recent = listMorningSessions(3);

  return (
    <div className="gate-shell">
      <AppHeader active="今日研判" />
      <Breadcrumb items={["价序", "价格晨会"]} />
      <main className="morning-shell">
        <MorningOpenPanel todaySession={plain(today)} recentCount={recent.length} />
      </main>
    </div>
  );
}

function plain<T>(value: T): T {
  return value ? (JSON.parse(JSON.stringify(value)) as T) : value;
}
