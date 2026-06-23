#!/usr/bin/env node
// Desktop + mobile screenshots driven by real clicks through the hero flow.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.HUNTER_DEV_PORT || "3000";
const BASE = process.env.DEMO_URL?.replace(/\/$/, "") || `http://127.0.0.1:${PORT}`;
const OUT = join(process.cwd(), "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  await page.waitForTimeout(700); // let entrance/state animations settle
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  console.log("  shot", name);
}

async function runMutation(page, chip) {
  await page.click(`[data-mutation-chip="${chip}"]`);
  await page.click("[data-cta-primary]");
  await page.waitForURL("**/result", { timeout: 40000 });
  await page.waitForLoadState("networkidle");
}

const main = async () => {
  await fetch(`${BASE}/api/admin/reseed`, { method: "POST" });
  const browser = await chromium.launch();

  // ---- Desktop ----
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/release/REL-2026-0623-07`, { waitUntil: "networkidle" });
  await shot(page, "01-release-gate.png");

  await runMutation(page, "future_date");
  await shot(page, "02-result-quarantine.png");

  await page.goto(`${BASE}/release/REL-2026-0623-07/replay`, { waitUntil: "networkidle" });
  await shot(page, "03-replay.png");

  await page.goto(`${BASE}/release/REL-2026-0623-07/proof`, { waitUntil: "networkidle" });
  await shot(page, "04-proof.png");

  await page.goto(`${BASE}/release/REL-2026-0623-07`, { waitUntil: "networkidle" });
  await runMutation(page, "access_denied");
  await shot(page, "05-result-approval.png");

  await page.goto(`${BASE}/release/REL-2026-0623-07/approval`, { waitUntil: "networkidle" });
  await shot(page, "06-approval.png");

  await page.goto(`${BASE}/queue`, { waitUntil: "networkidle" });
  await shot(page, "07-queue.png");

  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await shot(page, "08-settings.png");

  await ctx.close();

  // ---- Mobile (iPhone 13) ----
  const mctx = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-CN" });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/release/sample`, { waitUntil: "networkidle" });
  await shot(mp, "09-mobile-gate.png");
  await runMutation(mp, "future_date");
  await shot(mp, "10-mobile-result.png");
  await mctx.close();

  await browser.close();
  console.log("[screenshots] done ->", OUT);
};

main().catch((e) => {
  console.error("[screenshots] error:", e.message);
  process.exit(1);
});
