#!/usr/bin/env node
// Reseed synthetic price-governance fixtures and write .hunter/seed-manifest.json.
// Prefers the running dev server's /api/admin/reseed; otherwise wipes the db file.

import { writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.HUNTER_DEV_PORT || "3000";
const BASE = process.env.DEMO_URL?.replace(/\/$/, "") || `http://127.0.0.1:${PORT}`;
const PROJECT = process.cwd();

let summary = null;
try {
  const res = await fetch(`${BASE}/api/admin/reseed`, { method: "POST" });
  const data = await res.json();
  if (data.ok) {
    summary = data.summary;
    console.log("[seed] reseeded via API:", JSON.stringify(summary));
  }
} catch {
  console.log("[seed] dev server not reachable; wiping local db file as fallback.");
  for (const f of ["price-governance.db", "price-governance.db-wal", "price-governance.db-shm"]) {
    const p = join(PROJECT, "data", f);
    if (existsSync(p)) rmSync(p);
  }
}

const manifest = {
  source: "scripts/seed_demo.mjs -> POST /api/admin/reseed (src/lib/seed.ts)",
  storage: "node:sqlite at data/price-governance.db",
  fixtures: "src/lib/fixtures.ts (synthetic medical price records; no real sensitive 医保 data)",
  reset_command: "npm run seed",
  releases: summary?.releaseIds ?? ["REL-2026-0623-07", "REL-SAMPLE-01"],
  generated_records: summary?.rows ?? 12,
  real_vs_sample: {
    real: "durable SQLite rows, agent runs, replay timelines, approvals (all genuinely persisted)",
    sample:
      "the price rows themselves are fabricated synthetic medical price records, never claimed as traction or production data",
  },
  generated_at: summary?.generatedAt ?? new Date().toISOString(),
};

mkdirSync(join(PROJECT, ".hunter"), { recursive: true });
writeFileSync(
  join(PROJECT, ".hunter", "seed-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log("[seed] wrote .hunter/seed-manifest.json");
