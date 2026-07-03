#!/usr/bin/env node
// Capture docs/screenshots/09-workspace-provider-failure.png
// Strategy: start `next dev` on an isolated port with a bogus OPENAI_API_KEY,
// drive the workspace happy path (attach demo source -> click prompt -> run),
// and screenshot the auth_failed / draft_unavailable state.
//
// The deterministic objects stay visible while drafts are marked unavailable,
// which is exactly the honest-failure surface we want to prove.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.FAIL_PORT || "3009";
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(process.cwd(), "docs", "screenshots");
const SHOT = "09-workspace-provider-failure.png";

// Same provider host/model as the live smoke, but a bogus key -> 401 -> auth_failed.
const SERVER_ENV = {
  ...process.env,
  OPENAI_API_KEY: "bad-key",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "https://api.stepfun.com/v1",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "step-3.7-flash",
  PORT,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startServer() {
  // `next dev` is the local path (npm run dev). Bind the isolated port.
  const child = spawn(
    "npx",
    ["next", "dev", "-p", PORT],
    { env: SERVER_ENV, stdio: ["ignore", "pipe", "pipe"] }
  );
  child.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + 120_000; // 2 min for cold start
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/workspace`, { method: "GET" });
      if (res.ok || res.status === 200 || res.status === 500) return; // up
    } catch {
      // not up yet
    }
    await sleep(1500);
  }
  throw new Error(`server did not come up on ${BASE} within 120s`);
}

const main = async () => {
  mkdirSync(OUT, { recursive: true });

  console.log(`[failure-shot] starting next dev on :${PORT} with bad key`);
  const server = startServer();
  try {
    await waitForServer();
    console.log("[failure-shot] server up; seeding demo data");
    await fetch(`${BASE}/api/admin/reseed`, { method: "POST" }).catch(() => {});

    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 920 },
      deviceScaleFactor: 2,
      locale: "zh-CN",
    });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/workspace`, { waitUntil: "networkidle" });

    // Attach the demo data source.
    await page.locator("[data-source-card]").first().click();
    await page.waitForSelector(".dataset-chip");

    // Fire the first business prompt -> triggers an agent run that hits the bad key.
    await page.locator("[data-prompt-chip]").first().click();

    // Wait for the run to settle into the degraded state. The provider returns 401
    // quickly, so the error surfaces fast.
    const matched = await page.waitForFunction(
      () => /auth_failed|降级|draft_unavailable|不可用/i.test(document.body.innerText || ""),
      { timeout: 60_000 }
    ).then(() => true).catch(() => false);
    // Give the UI a moment to paint the badge + object panel.
    await sleep(1500);

    // Record the exact degraded text present on the page, as proof the shot is truthful.
    const bodyText = await page.evaluate(() => document.body.innerText || "");
    const degradedLine = bodyText
      .split("\n")
      .find((l) => /auth_failed|降级|draft_unavailable|不可用/i.test(l)) || "(not found)";
    console.log(`[failure-shot] degraded-text match=${matched} line="${degradedLine.trim()}"`);

    await page.screenshot({ path: join(OUT, SHOT), fullPage: true });
    console.log("[failure-shot] wrote", SHOT);

    if (!matched) {
      throw new Error("degraded state text never appeared; screenshot would be misleading");
    }

    await ctx.close();
    await browser.close();
  } finally {
    console.log("[failure-shot] shutting down server");
    server.kill("SIGTERM");
    // ensure we exit even if next lingers
    setTimeout(() => server.kill("SIGKILL"), 4000);
  }
};

main().catch((e) => {
  console.error("[failure-shot] error:", e.message);
  process.exit(1);
});
