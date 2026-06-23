import { NextResponse } from "next/server";
import { getProviderStatus } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Non-secret provider metadata only (presence, host, model, sources checked).
  return NextResponse.json(getProviderStatus());
}
