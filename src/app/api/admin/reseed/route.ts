import { NextResponse } from "next/server";
import { reseed } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const summary = reseed();
  return NextResponse.json({ ok: true, summary });
}
