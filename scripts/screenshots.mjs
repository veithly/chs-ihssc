#!/usr/bin/env node
// Desktop + mobile screenshots for the renewed /workspace product loop.
import { chromium, devices } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.HUNTER_DEV_PORT || "3300";
const BASE = process.env.DEMO_URL?.replace(/\/$/, "") || `http://127.0.0.1:${PORT}`;
const OUT = join(process.cwd(), "docs", "screenshots");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  console.log("  shot", name);
}

async function reset() {
  await fetch(`${BASE}/api/admin/reseed`, { method: "POST" });
}

const main = async () => {
  await reset();
  const browser = await chromium.launch();

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/workspace`, { waitUntil: "networkidle" });
  await shot(page, "01-workspace-empty.png");

  await page.locator("[data-source-card]").first().click();
  await page.waitForSelector(".dataset-chip");
  await shot(page, "02-source-attached.png");

  const firstPrompt = page.locator("[data-prompt-chip]").first();
  await firstPrompt.click();
  await page.waitForSelector('[data-agent-plan="running"]', { timeout: 3000 }).catch(() => {});
  await shot(page, "03-agent-running.png");

  await page.waitForSelector("[data-generated-object] .object-tab-count", {
    timeout: 90000,
  });
  // Wait for at least one tab to report a non-zero count (agent finished).
  await page.waitForFunction(() => {
    const counts = Array.from(document.querySelectorAll("[data-generated-object] .object-tab-count"));
    return counts.some((c) => Number((c.textContent ?? "").trim()) > 0);
  }, { timeout: 90000 });
  await shot(page, "04-agent-result.png");

  // Mapping tab is default; scroll the tab body into view.
  await page.locator("[data-field-mapping]").scrollIntoViewIfNeeded();
  await shot(page, "05-field-mapping-repair.png");

  // Switch to the institution drafts tab and capture it.
  await page.locator(".object-tab", { hasText: "机构口径" }).click();
  await page.locator("[data-draft-preview]").scrollIntoViewIfNeeded();
  await shot(page, "06-workflow-drafts.png");

  await page.locator("[data-conversation-composer] textarea").fill("把重点机构放前面，缺包装单位的先转数据治理确认。");
  await page.locator("[data-conversation-composer] button").click();
  await page.waitForResponse((res) => res.url().includes("/api/workspace/run") && res.status() === 200, {
    timeout: 90000,
  }).catch(() => {});
  await page.waitForTimeout(1000);
  await shot(page, "07-followup-instruction.png");
  await ctx.close();

  await reset();
  const mctx = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-CN" });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/workspace`, { waitUntil: "networkidle" });
  await shot(mp, "08-mobile-workspace.png");
  await mctx.close();

  // Landing page hero + deep-link loop proof.
  await reset();
  const lctx = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  const lp = await lctx.newPage();
  await lp.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shot(lp, "10-landing-hero.png");
  // Click the first landing prompt to deep-link into /workspace?prompt=...
  await lp.locator("[data-prompt-rail] [data-prompt-chip]").first().click();
  await lp.waitForURL(/\/workspace\?prompt=/, { timeout: 5000 });
  await lp.waitForFunction(() => {
    const counts = Array.from(document.querySelectorAll("[data-generated-object] .object-tab-count"));
    return counts.some((c) => Number((c.textContent ?? "").trim()) > 0);
  }, { timeout: 90000 });
  await shot(lp, "11-landing-loop-proof.png");
  await lctx.close();

  await browser.close();
  console.log("[screenshots] done ->", OUT);
};

main().catch((e) => {
  console.error("[screenshots] error:", e.message);
  process.exit(1);
});
