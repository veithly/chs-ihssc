#!/usr/bin/env node
// Desktop + mobile screenshots for the renewed /workspace product loop.
import { chromium, devices } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const PORT = process.env.HUNTER_DEV_PORT || "3300";
const BASE = process.env.DEMO_URL?.replace(/\/$/, "") || `http://127.0.0.1:${PORT}`;
const OUT = join(process.cwd(), "docs", "screenshots");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 点击演示数据源卡片；SSR 水合未完成时点击会被吞掉，超时后重试。
async function clickSourceCard(page) {
  for (let i = 0; i < 3; i += 1) {
    await page.locator("[data-source-card]").first().click();
    const ok = await page
      .waitForSelector(".dataset-chip", { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  throw new Error("source card click never produced dataset-chip");
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, name), fullPage: true });
  console.log("  shot", name);
}

// 文档截图统一隐藏桌宠：fullPage 拼接时 fixed 定位的小序会悬在页面中部，
// 视频里已有它的出镜；产品截图保持信息密度。
function hidePet(ctx) {
  return ctx.addInitScript(() => {
    try {
      localStorage.setItem("chs.desktopPet.enabled", "false");
    } catch {}
  });
}

async function reset() {
  await fetch(`${BASE}/api/admin/reseed`, { method: "POST" });
}

// 灌入一条 active 学习规则用于演示（reseed 会清空 rule_candidate）。
async function seedDemoRule() {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(join(process.cwd(), "data", "price-governance.db"));
  const now = new Date().toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO rule_candidate (id, trigger_json, proposed_action_json, confidence, support_count, status, hit_count, reviewer, review_notes, decided_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "RC-DEMO-001",
    JSON.stringify({ issue_type: "collective_not_landed", severity: "medium" }),
    JSON.stringify({ task_type: "集采落地催办", owner_role: "集采落地专班", priority: "medium", status: "自动处置" }),
    0.93, 18, "active", 7, "价格治理审核员", "历史 18 次同类决策一致批准，激活自动处置。", now, now, now,
  );
  db.close();
}

const main = async () => {
  await reset();
  const browser = await chromium.launch();

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  await hidePet(ctx);
  const page = await ctx.newPage();

  await page.goto(`${BASE}/workspace`, { waitUntil: "networkidle" });
  await shot(page, "01-workspace-empty.png");

  await clickSourceCard(page);
  await shot(page, "02-source-attached.png");

  const firstPrompt = page.locator("[data-prompt-chip]").first();
  await firstPrompt.click();
  // 运行中的对话流：乐观 user 气泡 + 即时应答 + 流式执行阶段
  await page.waitForSelector("[data-agent-steps]", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1600);
  await shot(page, "03-agent-running.png");

  // 等 run API 真正返回 200，而不是轮询 DOM（provider 可能 30-60 秒）。
  await page.waitForResponse(
    (res) => res.url().includes("/api/workspace/run") && res.status() === 200,
    { timeout: 120000 },
  ).catch(() => {});
  // run 返回后，等客户端 snapshot 刷新出非零 count。
  await page.waitForSelector("[data-generated-object] .object-tab-count", { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => {
    const counts = Array.from(document.querySelectorAll("[data-generated-object] .object-tab-count"));
    return counts.some((c) => Number((c.textContent ?? "").trim()) > 0);
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await shot(page, "04-agent-result.png");

  // 字段映射/修复证据在「数据修复」tab 里（run 后自动切到漂移/人审 tab）。
  await page.locator(".object-tab", { hasText: "数据修复" }).click();
  await page.locator("[data-field-mapping]").scrollIntoViewIfNeeded();
  await shot(page, "05-field-mapping-repair.png");

  // Switch to the disposition drafts tab and capture it.
  await page.locator(".object-tab", { hasText: "处置建议卡" }).click();
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
  await hidePet(mctx);
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/workspace`, { waitUntil: "networkidle" });
  await shot(mp, "08-mobile-workspace.png");
  await mctx.close();

  // V2 政策引擎面板截图：灌入演示数据（激活规则 + 政策同步 + 触发漂移），截图。
  await reset();
  // 1. 同步国家医保局公告（真实抓取留痕）
  await fetch(`${BASE}/api/workspace/policy-sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  // 2. reseed 后重新灌入一条 active 学习规则（演示"已激活规则·下批自动复用"）
  await seedDemoRule();
  const vctx = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  await hidePet(vctx);
  const vp = await vctx.newPage();
  // 连 demo source + 跑一次（产生 disposition 供规则引擎作用）
  await vp.goto(`${BASE}/workspace`, { waitUntil: "networkidle" });
  await clickSourceCard(vp);
  await vp.locator("[data-prompt-chip]").first().click();
  await vp.waitForResponse(
    (res) => res.url().includes("/api/workspace/run") && res.status() === 200,
    { timeout: 120000 },
  ).catch(() => {});
  await vp.waitForTimeout(1500);
  // 3. 政策更新触发漂移（把一个 item 的中选价下调）
  await fetch(`${BASE}/api/workspace/policy-update`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemCode: "HC-LNS-902", collective_price: 560 }),
  });
  // 4. 切到「政策事实」tab。run 结束后的异步 refreshPolicy 会 setActiveTab("drift")，
  //    可能盖掉我们的点击，所以循环点击直到 fact tab 真正保持激活。
  for (let i = 0; i < 5; i += 1) {
    await vp.locator(".object-tab", { hasText: "政策事实" }).click();
    await vp.waitForTimeout(1200);
    const stayed = await vp.evaluate(
      () => document.querySelector(".object-tab.active .object-tab-label")?.textContent === "政策事实",
    );
    if (stayed) break;
  }
  await vp.waitForSelector("[data-policy-source]", { timeout: 8000 }).catch(() => {});
  await vp.locator("[data-policy-facts]").scrollIntoViewIfNeeded().catch(() => {});
  await vp.waitForTimeout(800);
  await shot(vp, "12-policy-engine.png");
  // 5. 漂移队列（政策更新后重跑检出的存量漂移）
  await vp.locator("[data-prompt-chip]").first().click();
  await vp.waitForResponse(
    (res) => res.url().includes("/api/workspace/run") && res.status() === 200,
    { timeout: 120000 },
  ).catch(() => {});
  await vp.waitForSelector("[data-drift-row]", { timeout: 15000 }).catch(() => {});
  await vp.waitForTimeout(1000);
  await shot(vp, "13-drift-queue.png");
  await vctx.close();

  // Landing page hero + deep-link loop proof.
  // IMPORTANT: the landing mini card reads real run stats, so the hero shot
  // must be taken AFTER a real run has produced persisted objects. We therefore
  // deep-link into /workspace, let the agent run once, then navigate back to /
  // so the hero shows non-zero stats (8 mappings · 3 repairs · 6 groups ·
  // 4 tasks · 4 drafts). Shooting the hero before any run yields all-zero stats.
  await reset();
  const lctx = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  await hidePet(lctx);
  const lp = await lctx.newPage();
  await lp.goto(`${BASE}/`, { waitUntil: "networkidle" });
  // Click the first landing prompt to deep-link into /workspace?prompt=...
  await lp.locator("[data-prompt-rail] [data-prompt-chip]").first().click();
  await lp.waitForURL(/\/workspace\?prompt=/, { timeout: 5000 });
  await lp.waitForResponse(
    (res) => res.url().includes("/api/workspace/run") && res.status() === 200,
    { timeout: 120000 },
  ).catch(() => {});
  await lp.waitForTimeout(1500);
  await shot(lp, "11-landing-loop-proof.png");
  // Now that a real run is persisted, navigate back to / and shoot the hero.
  await lp.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shot(lp, "10-landing-hero.png");
  await lctx.close();

  // 批次闸门结果页：真实 release-gate run 后截图（差比价折算超限 + 64号红黄分档徽标）。
  await reset();
  console.log("[screenshots] running release-gate scan (live provider, ~40s)...");
  const gate = await fetch(`${BASE}/api/agent/release-gate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ releaseId: "REL-2026-0623-07" }),
  }).then((r) => r.json()).catch(() => null);
  if (!gate?.ok) {
    throw new Error(`release-gate scan failed (${gate?.error_category ?? "unknown"}); 14-release-result-tiers.png needs a successful run`);
  }
  const rctx = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
  });
  await hidePet(rctx);
  const rp = await rctx.newPage();
  await rp.goto(`${BASE}/release/REL-2026-0623-07/result`, { waitUntil: "networkidle" });
  await rp.waitForSelector(".dist-grid", { timeout: 20000 });
  await rp.waitForTimeout(800);
  await shot(rp, "14-release-result-tiers.png");
  await rctx.close();

  await browser.close();
  console.log("[screenshots] done ->", OUT);
};

main().catch((e) => {
  console.error("[screenshots] error:", e.message);
  process.exit(1);
});
