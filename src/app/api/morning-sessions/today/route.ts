import { NextResponse } from "next/server";
import {
  getReplayBySession,
  getTodayMorningSession,
  listDailyLeads,
  listMorningSessions,
} from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = getTodayMorningSession();
  if (!session) {
    return NextResponse.json({
      ok: true,
      session: null,
      recent: listMorningSessions(3),
      leads: [],
      replay: [],
    });
  }

  return NextResponse.json({
    ok: true,
    session,
    recent: listMorningSessions(3),
    leads: listDailyLeads(session.id),
    replay: JSON.parse(getReplayBySession(session.id)?.events_json ?? "[]"),
  });
}
