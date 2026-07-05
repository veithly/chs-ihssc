#!/usr/bin/env node
// Full-feature walkthrough video for 价序 — a training cut for the presenter.
//
// Unlike the pitch video (deck + demo), this is 100% live product footage,
// clicked step by step exactly the way a human would demo it on stage:
//   landing → hero prompt → run① → proposal card (auto-fix + edit + adopt)
//   → 人审任务 approve ×2 → 政策依据 upload CSV (intranet story) → confirm 560
//   → run② drift → approve 集采催办 on the card → 待审规则 mine → dry-run →
//   activate → run③ auto-dispose + audit strip → top-nav 待办核验 → open batch
//   → 发起价格治理 (live progress) → auto-redirect result page (red/yellow tiers).
//
// No page.goto after the initial landing load — every transition is a click.
//
// Pipeline mirrors record_demo.mjs: record beats → retime per beat to the
// narration → MiMo/say TTS → HyperFrames overlay (step chip + captions +
// callouts) → render → mux BGM+narration → QA + keyframe extraction.
import { chromium } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.DEMO_URL?.replace(/\/$/, "") || "http://127.0.0.1:3123";
const OUT = join(ROOT, "docs", "video");
const PROJECT = join(OUT, "full-demo");
const ASSETS = join(PROJECT, "assets");
const QA = join(PROJECT, "qa");
const WORK = join(OUT, "_work-full");
const NARRATION_SOURCE = join(OUT, "full-demo-narration.txt");
const CSV_PATH = join(ROOT, "docs", "demo-assets", "集采中选价调整通知-苏医保-202606.csv");
const WIDTH = 1920;
const HEIGHT = 1080;
const HF_VERSION = process.env.HYPERFRAMES_VERSION || "0.7.5";
const HF = ["--yes", `hyperframes@${HF_VERSION}`];
const TTS_PROVIDER = process.env.TTS_PROVIDER || "say";
const TTS_VOICE = process.env.TTS_VOICE || "Tingting";
const TTS_RATE = process.env.TTS_RATE || "165";
const BGM_DIR =
  process.env.BGM_DIR ||
  join(ROOT, "..", "..", "..", "..", ".claude", "skills", "hackathonhunter", "assets", "music");
const BGM_INTRO = process.env.BGM_INTRO || "01_future_forward.mp3";
const BGM_MID = process.env.BGM_MID || "02_innovation_drive.mp3";
const REUSE_DEMO_FOOTAGE = process.env.REUSE_DEMO_FOOTAGE === "1";

const HERO_PROMPT_KEY = "drift_review_loop";
const RELEASE_ID = "REL-2026-0623-07";

const SEG_IDS = [
  "demo0",
  "demo1",
  "demo2",
  "demo3",
  "demo4",
  "demo5",
  "demo6",
  "demo7",
  "demo8",
  "demo9",
];

// Which recorded beats belong to which narration segment.
const SEG_MAP = {
  demo0: ["b0-landing"],
  demo1: ["b1-run1", "b1-report"],
  demo2: ["b2-card"],
  demo3: ["b3-tasks"],
  demo4: ["b4-upload"],
  demo5: ["b5-rerun", "b5-wait", "b5-drift"],
  demo6: ["b6-rules"],
  demo7: ["b7-rerun", "b7-wait", "b7-auto"],
  demo8: ["b8-nav", "b8-scan", "b8-result"],
  demo9: ["b9-close"],
};

const STEP_CHIP = {
  demo0: "第 1 步 · 一句话发起核查",
  demo1: "第 2 步 · 核查步骤实时可见",
  demo2: "第 3 步 · 提案卡：改完即采纳",
  demo3: "第 4 步 · 人审任务批准",
  demo4: "第 5 步 · 内网上传政策文件",
  demo5: "第 6 步 · 政策变更后重查",
  demo6: "第 7 步 · 人审结论沉淀为规则",
  demo7: "第 8 步 · 自动处置验证",
  demo8: "第 9 步 · 整批监测出证",
  demo9: "全流程闭环",
};

// Bottom captions are generated 1:1 from the narration text (sentence-level),
// timed proportionally to character count within each narration segment.

const CALLOUT_TEXT = {
  demo0: "点「按最新政策核对执行价并出处置提案」",
  demo1: "步骤条：读取 → 比对政策 → 逐行核对",
  demo2: "修复值可编辑 → 采纳并回写 · 一键采纳",
  demo3: "选「机构核实」→ 批准 → 决策留痕",
  demo4: "上传政策文件 → 解析 3 条 → 人审确认生效",
  demo5: "政策价 560 元 · 超价机构被点名 → 集采催办",
  demo6: "影响面预览 → 人工激活",
  demo7: "状态 = 自动处置 · 审计留痕可查",
  demo8: "发起价格治理 → 实时进度 → 处置结果单",
  demo9: "价序 · 医保价格治理闭环",
};

function run(cmd, args, options = {}) {
  console.log(">", cmd, args.join(" "));
  return execFileSync(cmd, args, { stdio: "inherit", ...options });
}

function captureOutput(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" });
}

function mediaInfo(path) {
  const raw = captureOutput("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_name,width,height,avg_frame_rate,bit_rate",
    "-of",
    "json",
    path,
  ]);
  return JSON.parse(raw);
}

function duration(path) {
  return Number(mediaInfo(path).format.duration);
}

function clean() {
  rmSync(WORK, { recursive: true, force: true });
  rmSync(PROJECT, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  mkdirSync(ASSETS, { recursive: true });
  mkdirSync(QA, { recursive: true });
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json().catch(() => null);
}

async function resetSamples() {
  const res = await fetch(`${BASE}/api/admin/reseed`, { method: "POST" }).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`Could not reset sample data at ${BASE}/api/admin/reseed`);
  }
}

async function spikeTaskTitles(threadId, runId) {
  const data = await api("GET", `/api/workspace/threads/${threadId}`);
  const snap = data?.snapshot ?? {};
  const dispById = new Map((snap.dispositionItems ?? []).map((d) => [d.id, d]));
  return (snap.workflowTasks ?? [])
    .filter(
      (task) =>
        (!runId || task.run_id === runId) &&
        !["已人审确认", "已驳回", "自动处置"].includes(task.status) &&
        task.disposition_id &&
        dispById.get(task.disposition_id)?.issue_type === "price_spike",
    )
    .map((task) => ({ id: task.id, title: task.title }));
}

async function recordProductFootage() {
  if (!existsSync(CSV_PATH)) {
    throw new Error(`Missing policy CSV sample: ${relative(ROOT, CSV_PATH)}`);
  }
  await resetSamples();
  // Pre-create the workspace thread + demo dataset so the recorder can inspect
  // task ids off-camera; the landing deep-link reuses this same thread.
  const src = await api("POST", "/api/workspace/source", { kind: "demo", sourceId: "demo-price-sheet" });
  const threadId = src?.snapshot?.thread?.id;
  if (!threadId) throw new Error("Could not pre-create the workspace thread via /api/workspace/source.");
  console.log(`[footage] thread ${threadId}, dataset rows: ${src?.snapshot?.dataset?.row_count}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: WORK, size: { width: WIDTH, height: HEIGHT } },
    locale: "zh-CN",
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("chs.desktopPet.enabled", "true");
      localStorage.setItem("chs.desktopPet.position", JSON.stringify({ x: 95, y: 91 }));
      localStorage.setItem("chs.desktopPet.collapsed", "false");
    } catch {}
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const vid = page.video();
  const wait = (ms) => page.waitForTimeout(ms);
  const t0 = Date.now();
  const beats = [];
  const mark = (id, kind) => {
    beats.push({ id, kind, t: Number(((Date.now() - t0) / 1000).toFixed(3)) });
    console.log(`[beat] ${id} (${kind}) @ ${beats.at(-1).t}s`);
  };

  const nextRunResponse = () =>
    page.waitForResponse(
      (res) =>
        res.url().includes("/api/workspace/run") &&
        res.request().method() === "POST" &&
        res.status() === 200,
      { timeout: 240000 },
    );

  const QUICK = { timeout: 4000 };
  const glance = async (locator) => {
    await locator.scrollIntoViewIfNeeded(QUICK).catch(() => {});
    await locator.hover(QUICK).catch(() => {});
  };

  async function approveTaskRow(task, settleMs = 2300) {
    const row =
      typeof task === "string"
        ? page.locator("[data-task-row]", { hasText: task }).first()
        : page.locator(`[data-task-row][data-task-id="${task.id}"]`).first();
    if ((await row.count()) === 0) return false;
    await glance(row);
    await wait(1000);
    const btn = row.locator(".mini-btn.approve").first();
    if ((await btn.count()) === 0) return false;
    await btn.hover(QUICK).catch(() => {});
    await wait(450);
    await btn.click(QUICK);
    await wait(settleMs);
    return true;
  }

  async function openObjectTab(label) {
    await page.locator(".object-tab", { hasText: label }).first().click();
    await wait(1000);
  }

  // Clicks the hero prompt chip + 开始核查, then marks `waitMarkId` and blocks
  // until the run response lands. Marking happens between the clicks and the
  // provider wait so the retimer can compress the wait without rushing clicks.
  async function rerunHeroPrompt(waitMarkId) {
    const chip = page.locator(`[data-prompt-chip][data-prompt-key="${HERO_PROMPT_KEY}"]`);
    await chip.scrollIntoViewIfNeeded(QUICK).catch(() => {});
    await chip.hover(QUICK).catch(() => {});
    await wait(600);
    const runWait = nextRunResponse();
    await chip.click();
    await wait(800);
    await page.locator("[data-composer-send]").click(QUICK);
    await wait(300);
    mark(waitMarkId, "wait");
    await runWait;
    await wait(1800);
  }

  // ---- demo0 · b0-landing: 首页 → hero 常用任务 --------------------------------
  mark("b0-landing", "action");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-landing-hero]");
  await wait(3000);
  await page.mouse.move(960, 560);
  await page.mouse.wheel(0, 480);
  await wait(2200);
  await page.mouse.wheel(0, -480);
  await wait(1600);
  const heroChip = page.locator(
    `[data-prompt-rail] [data-prompt-chip][data-prompt-key="${HERO_PROMPT_KEY}"]`,
  );
  await heroChip.scrollIntoViewIfNeeded().catch(() => {});
  await heroChip.hover().catch(() => {});
  await wait(2000);
  const runWait1 = nextRunResponse();
  await heroChip.click();
  await page.waitForURL(/\/workspace\?prompt=/, { timeout: 20000 });
  await page.waitForSelector("[data-conversation-composer]", { timeout: 30000 });
  await wait(1400);

  // ---- demo1 · b1-run1(wait) + b1-report: 看步骤条，读汇报 ----------------------
  mark("b1-run1", "wait");
  await runWait1;
  await wait(1800);

  mark("b1-report", "action");
  await page.mouse.move(760, 560);
  await page.mouse.wheel(0, 420);
  await wait(2200);
  await page.mouse.wheel(0, 420);
  await wait(2800);

  // ---- demo2 · b2-card: 提案卡（自动修复 chip → 编辑修复值 → 采纳 → 一键采纳） --
  mark("b2-card", "action");
  const proposalCard = page.locator("[data-proposal-card]").first();
  await proposalCard.scrollIntoViewIfNeeded(QUICK).catch(() => {});
  await wait(1600);
  await glance(proposalCard.locator("[data-auto-fixed]").first());
  await wait(3200);
  const editRow = proposalCard.locator("[data-repair-proposal]:has([data-repair-input])").first();
  if ((await editRow.count()) > 0) {
    const input = editRow.locator("[data-repair-input]").first();
    const current = await input.inputValue().catch(() => "");
    await input.click({ clickCount: 3, timeout: 4000 }).catch(() => {});
    await wait(900);
    if (current) {
      await input.pressSequentially(current, { delay: 160 }).catch(() => {});
    }
    await wait(1600);
    const applyBtn = editRow.locator("[data-repair-apply]").first();
    await applyBtn.hover(QUICK).catch(() => {});
    await wait(800);
    await applyBtn.click(QUICK).catch(() => {});
    await wait(3400);
  }
  const applyAll = proposalCard.locator("[data-apply-all-repairs]").first();
  if ((await applyAll.count()) > 0) {
    await applyAll.hover(QUICK).catch(() => {});
    await wait(900);
    await applyAll.click(QUICK).catch(() => {});
    await wait(4200);
  }

  // ---- demo3 · b3-tasks: 人审任务 tab，批 2 条涨幅异常 --------------------------
  mark("b3-tasks", "action");
  const spikes1 = await spikeTaskTitles(threadId);
  console.log(`[footage] run1 spike tasks: ${spikes1.map((s) => s.title).join(" | ")}`);
  await openObjectTab("人审任务");
  await wait(1200);
  let approvedOnCamera = 0;
  for (const spike of spikes1.slice(0, 2)) {
    if (await approveTaskRow(spike, 3200)) approvedOnCamera += 1;
  }
  await glance(page.locator(".task-final").first());
  await wait(3400);

  // ---- demo4 · b4-upload: 政策依据 tab → 上传 CSV → 人审确认 → 560 生效 ---------
  mark("b4-upload", "action");
  await openObjectTab("政策依据");
  await wait(1600);
  const factRow = page.locator('[data-fact-row][data-fact-code="HC-LNS-902"]').first();
  await glance(factRow);
  await wait(2600);
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 15000 });
  await page.locator("[data-policy-upload]").hover(QUICK).catch(() => {});
  await wait(1100);
  await page.locator("[data-policy-upload]").click(QUICK);
  const chooser = await chooserPromise;
  await wait(900);
  await chooser.setFiles(CSV_PATH);
  await page.waitForSelector("[data-artifact-suggested]", { timeout: 20000 });
  await wait(1600);
  await glance(page.locator("[data-artifact-suggested]").first());
  await wait(3000);
  const confirmFactsBtn = page.locator("[data-artifact-confirm-facts]").first();
  await confirmFactsBtn.hover(QUICK).catch(() => {});
  await wait(900);
  await confirmFactsBtn.click(QUICK);
  await page
    .waitForFunction(
      () => {
        const row = document.querySelector('[data-fact-row][data-fact-code="HC-LNS-902"]');
        return row ? (row.textContent ?? "").includes("560") : false;
      },
      undefined,
      { timeout: 20000 },
    )
    .catch(() => {});
  await wait(1500);
  await glance(factRow);
  await wait(3600);

  // ---- demo5 · b5-rerun + b5-wait + b5-drift: 重查 → 漂移 → 卡上批准催办 --------
  mark("b5-rerun", "action");
  await rerunHeroPrompt("b5-wait");

  mark("b5-drift", "action");
  await page.waitForSelector("[data-drift-row]", { timeout: 20000 }).catch(() => {});
  await wait(1800);
  const lnsDrift = page.locator("[data-drift-row]", { hasText: "HC-LNS-902" }).first();
  await glance((await lnsDrift.count()) > 0 ? lnsDrift : page.locator("[data-drift-row]").first());
  await wait(3200);
  // 会话流里最新提案卡：批准「人工晶体…高于集采中选价」的政策漂移复核（默认动作=集采催办）
  const lastCard = page.locator("[data-proposal-card]").last();
  await page.mouse.move(760, 560);
  await lastCard.scrollIntoViewIfNeeded(QUICK).catch(() => {});
  await wait(1400);
  let driftTaskRow = lastCard.locator("[data-task-proposal]", { hasText: "高于集采中选价" }).first();
  if ((await driftTaskRow.count()) === 0) {
    driftTaskRow = lastCard.locator("[data-task-proposal]", { hasText: "政策漂移" }).first();
  }
  if ((await driftTaskRow.count()) > 0) {
    await glance(driftTaskRow);
    await wait(3200);
    const approveBtn = driftTaskRow.locator("[data-task-approve]").first();
    await approveBtn.hover(QUICK).catch(() => {});
    await wait(800);
    await approveBtn.click(QUICK).catch(() => {});
    await wait(3600);
  } else {
    // 卡上不可见（超过前 6 条）→ 右侧人审任务里批准，同样是真实链路
    await openObjectTab("人审任务");
    await approveTaskRow("高于集采中选价", 3200);
  }

  // 规则挖掘需要同类样本 ≥3：镜头外补足 run② 的涨幅异常人审（真实 API，同一决策链路）
  const spikes2 = await spikeTaskTitles(threadId);
  for (const spike of spikes2.slice(0, Math.max(0, 3 - approvedOnCamera))) {
    await api("POST", `/api/workspace/tasks/${spike.id}/decision`, {
      decision: "approve",
      final_action: "机构核实",
      reviewer: "价格治理审核员",
      notes: "演示补充决策",
    });
  }

  // ---- demo6 · b6-rules: 从人审结论整理规则 → 影响面预览 → 激活 -----------------
  mark("b6-rules", "action");
  await openObjectTab("待审规则");
  await wait(1600);
  const mineBtn = page.locator("button", { hasText: /从人审(结论整理规则|反馈挖掘候选)/ }).first();
  await mineBtn.hover(QUICK).catch(() => {});
  await wait(1000);
  await mineBtn.click();
  await page.waitForSelector("[data-rule-candidate]", { timeout: 20000 });
  await wait(2200);
  const candidate = page.locator("[data-rule-candidate]").first();
  await glance(candidate.locator(".rc-trigger"));
  await wait(2600);
  const dryBtn = candidate.locator("button", { hasText: "影响面预览" }).first();
  await dryBtn.hover(QUICK).catch(() => {});
  await wait(700);
  await dryBtn.click(QUICK).catch(() => {});
  await page.waitForSelector("[data-rule-dryrun]", { timeout: 15000 }).catch(() => {});
  await wait(1500);
  await glance(candidate.locator("[data-rule-dryrun]"));
  await wait(3200);
  const activateBtn = candidate.locator(".mini-btn.approve", { hasText: "激活" }).first();
  await activateBtn.hover(QUICK).catch(() => {});
  await wait(800);
  await activateBtn.click();
  await page.waitForSelector("[data-active-rule]", { timeout: 15000 }).catch(() => {});
  await wait(1500);
  await glance(page.locator("[data-active-rule]").first());
  await wait(3000);

  // ---- demo7 · b7-rerun + b7-wait + b7-auto: run③ 自动处置 + 审计留痕 -----------
  mark("b7-rerun", "action");
  await rerunHeroPrompt("b7-wait");

  mark("b7-auto", "action");
  await openObjectTab("人审任务");
  await wait(1500);
  await glance(page.locator('[data-task-row][data-task-status="自动处置"]').first());
  await wait(3600);
  await glance(page.locator('[data-task-row]:not([data-task-status="自动处置"])').first());
  await wait(2800);
  await glance(page.locator("[data-audit-strip]"));
  await wait(4200);

  // ---- demo8 · b8-nav + b8-scan + b8-result: 待办核验 → 批次 → 监测 → 结果单 -----
  mark("b8-nav", "action");
  const navQueue = page.locator(".app-nav-link", { hasText: "待办核验" }).first();
  await navQueue.hover(QUICK).catch(() => {});
  await wait(1000);
  await navQueue.click();
  await page.waitForSelector(".queue-row", { timeout: 20000 });
  await wait(2200);
  const relRow = page.locator(".queue-row", { hasText: RELEASE_ID }).first();
  await glance(relRow);
  await wait(1600);
  await relRow.click();
  await page.waitForSelector("[data-cta-primary]", { timeout: 20000 });
  await wait(2000);
  await page.mouse.move(960, 620);
  await page.mouse.wheel(0, 380);
  await wait(2000);
  await page.mouse.wheel(0, 320);
  await wait(1600);

  mark("b8-scan", "wait");
  const ctaRun = page.locator("[data-cta-primary]");
  await ctaRun.scrollIntoViewIfNeeded(QUICK).catch(() => {});
  await ctaRun.hover(QUICK).catch(() => {});
  await wait(600);
  await ctaRun.click();
  // 成功后 ReleaseGate 会 router.push 到 /result —— 真实产品行为，不跳 URL。
  let reachedResult = await page
    .waitForURL(new RegExp(`/release/${RELEASE_ID}/result`), { timeout: 150000 })
    .then(() => true)
    .catch(() => false);
  if (!reachedResult) {
    console.warn("[footage] release scan attempt 1 did not reach result → clicking again");
    await ctaRun.click(QUICK).catch(() => {});
    reachedResult = await page
      .waitForURL(new RegExp(`/release/${RELEASE_ID}/result`), { timeout: 180000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!reachedResult) {
    throw new Error("Release-gate scan never reached the result page; cannot finish beat b8.");
  }

  mark("b8-result", "action");
  await page.waitForSelector(".dist-grid", { timeout: 20000 });
  await wait(2600);
  await glance(page.locator(".result-issue-badges"));
  await wait(2400);
  const affectedTable = page.locator(".batch-scroll").first();
  await affectedTable.scrollIntoViewIfNeeded(QUICK).catch(() => {});
  await wait(1800);
  await glance(page.locator(".batch-table tr", { hasText: "红色预警" }).first());
  await wait(3000);
  await glance(page.locator(".batch-table tr", { hasText: "差比价折算超限" }).first());
  await wait(3000);

  // ---- demo9 · b9-close: 回到结果单顶部收尾 -------------------------------------
  mark("b9-close", "action");
  await page.mouse.move(960, 420);
  await page.mouse.wheel(0, -900);
  await wait(2200);
  await glance(page.locator(".result-summary").first());
  await wait(4200);

  mark("end", "end");
  await ctx.close();
  await browser.close();

  const webm = await vid.path();
  const raw = join(ASSETS, "demo-footage.mp4");
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    webm,
    "-vf",
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-sc_threshold",
    "0",
    "-movflags",
    "+faststart",
    "-an",
    raw,
  ]);
  writeFileSync(join(ASSETS, "demo-beats.json"), JSON.stringify({ threadId, beats }, null, 2), "utf8");
  return { raw, beats };
}

function parseNarrationSegments(raw) {
  const lines = raw.split(/\r?\n/);
  const segments = [];
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current) {
      const text = buffer.join("\n").trim();
      if (text) segments.push({ ...current, text });
      buffer = [];
    }
  };
  for (const line of lines) {
    const m = line.match(/^\[([a-zA-Z0-9_-]+):(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\]\s*$/);
    if (m) {
      flush();
      current = { id: m[1], start: Number(m[2]), end: Number(m[3]) };
    } else {
      buffer.push(line);
    }
  }
  flush();
  return segments.sort((a, b) => a.start - b.start);
}

async function generateAudio() {
  if (!existsSync(NARRATION_SOURCE)) {
    throw new Error(`Missing narration source: ${relative(ROOT, NARRATION_SOURCE)}`);
  }
  const raw = readFileSync(NARRATION_SOURCE, "utf8").trim();
  if (!raw) throw new Error("Narration source is empty.");
  writeFileSync(join(ASSETS, "narration.txt"), `${raw}\n`, "utf8");

  const segments = parseNarrationSegments(raw);
  const missing = SEG_IDS.filter((id) => !segments.some((s) => s.id === id));
  if (missing.length > 0) throw new Error(`Narration missing segments: ${missing.join(", ")}`);
  console.log(`[narration] ${segments.length} segment(s): ${segments.map((s) => s.id).join(", ")}`);

  if (TTS_PROVIDER === "say") return generateSayAudioSegments(segments);
  if (TTS_PROVIDER === "mimo") return generateMimoAudioSegments(segments);
  throw new Error(`Unsupported TTS_PROVIDER=${TTS_PROVIDER}. Use "say" or "mimo".`);
}

function generateSayAudioSegments(segments) {
  const out = [];
  for (const seg of segments) {
    const aiff = join(ASSETS, `narration-${seg.id}.aiff`);
    const txt = join(ASSETS, `narration-${seg.id}.txt`);
    const m4a = join(ASSETS, `narration-${seg.id}.m4a`);
    writeFileSync(txt, `${seg.text}\n`, "utf8");
    run("say", ["-v", TTS_VOICE, "-r", TTS_RATE, "-o", aiff, "-f", txt]);
    run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", aiff,
      "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "160k",
      m4a,
    ]);
    out.push({ id: seg.id, start: seg.start, end: seg.end, text: seg.text, file: m4a, duration: duration(m4a) });
  }
  return { segments: out, narration: readFileSync(NARRATION_SOURCE, "utf8") };
}

async function generateMimoAudioSegments(segments) {
  const apiKey = process.env.TTS_API_KEY || process.env.MIMO_API_KEY;
  const baseUrl = (process.env.TTS_BASE_URL || process.env.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1").replace(/\/$/, "");
  const model = process.env.TTS_MODEL || process.env.MIMO_TTS_MODEL || "mimo-v2.5-tts";
  const voiceName = process.env.TTS_VOICE || "Chloe";
  const instruction = process.env.TTS_INSTRUCTION || "";
  const format = (process.env.TTS_FORMAT || "wav").toLowerCase();
  const maxChars = Number(process.env.TTS_CHUNK_MAX_CHARS || 900);
  if (!apiKey) throw new Error("TTS_PROVIDER=mimo needs TTS_API_KEY or MIMO_API_KEY.");

  const out = [];
  for (let si = 0; si < segments.length; si += 1) {
    const seg = segments[si];
    const subChunks = splitNarration(seg.text, maxChars);
    console.log(`[mimo] segment ${si + 1}/${segments.length} id=${seg.id} → ${subChunks.length} chunk(s)`);
    const subFiles = [];
    for (let i = 0; i < subChunks.length; i += 1) {
      const text = subChunks[i];
      const outPath = join(ASSETS, `narration-${seg.id}-chunk-${String(i).padStart(2, "0")}.${format}`);
      if (existsSync(outPath)) {
        subFiles.push(outPath);
        continue;
      }
      const body = buildMimoBody({ model, voice: voiceName, format, instruction, text });
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          api_key: apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`MiMo TTS ${seg.id} chunk ${i + 1} HTTP ${res.status}: ${errText.slice(0, 400)}`);
      }
      const json = await res.json();
      const audioData = json?.choices?.[0]?.message?.audio?.data;
      if (!audioData) {
        throw new Error(`MiMo TTS ${seg.id} chunk ${i + 1} returned no audio data.`);
      }
      writeFileSync(outPath, Buffer.from(audioData, "base64"));
      subFiles.push(outPath);
    }
    const segM4a = join(ASSETS, `narration-${seg.id}.m4a`);
    if (subFiles.length === 1) {
      run("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", subFiles[0],
        "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "160k",
        segM4a,
      ]);
    } else {
      const concatList = join(ASSETS, `narration-${seg.id}-concat.txt`);
      writeFileSync(concatList, subFiles.map((f) => `file '${f}'`).join("\n") + "\n", "utf8");
      run("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", concatList,
        "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "160k",
        segM4a,
      ]);
    }
    out.push({ id: seg.id, start: seg.start, end: seg.end, text: seg.text, file: segM4a, duration: duration(segM4a) });
    console.log(`[mimo] segment ${seg.id} done ${out[out.length - 1].duration.toFixed(2)}s`);
  }
  return { segments: out, narration: readFileSync(NARRATION_SOURCE, "utf8") };
}

function splitNarration(text, maxChars) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    if (para.length <= maxChars) {
      current = para;
      continue;
    }
    const sentences = para.split(/(?<=[。！？!?；;])/);
    for (const s of sentences) {
      const cand = current ? `${current}${s}` : s;
      if (cand.length <= maxChars) {
        current = cand;
      } else {
        if (current) chunks.push(current);
        current = s;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildMimoBody({ model, voice, format, instruction, text }) {
  const messages = [];
  if (instruction) {
    messages.push({ role: "user", content: instruction });
    messages.push({ role: "assistant", content: text });
  } else {
    messages.push({ role: "assistant", content: text });
  }
  return { model, messages, audio: { format, voice } };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildFinalAudio(narrationSegments, total) {
  const intro = join(BGM_DIR, BGM_INTRO);
  const mid = join(BGM_DIR, BGM_MID);
  if (!existsSync(intro) || !existsSync(mid)) {
    throw new Error(`Missing BGM tracks under ${BGM_DIR}; set BGM_DIR.`);
  }
  const introCopy = join(ASSETS, "bgm-intro.mp3");
  const midCopy = join(ASSETS, "bgm-mid.mp3");
  copyFileSync(intro, introCopy);
  copyFileSync(mid, midCopy);

  const out = join(ASSETS, "audio-final.m4a");
  const fadeOutStart = Math.max(0, total - 1.5).toFixed(2);
  const GAP = 0.4;
  let cursor = 0;
  for (const seg of narrationSegments) {
    const placedStart = Math.max(seg.start, cursor);
    seg.placedStart = placedStart;
    cursor = placedStart + seg.duration + GAP;
  }
  if (cursor > total + 0.5) {
    console.warn(`[audio] narration packs to ${cursor.toFixed(1)}s > ${total}s; tail may be trimmed.`);
  }

  const inputs = ["-i", introCopy, "-i", midCopy, "-i", introCopy];
  narrationSegments.forEach((seg) => {
    inputs.push("-i", seg.file);
  });
  const narrLabels = narrationSegments
    .map((seg, i) => {
      const delayMs = Math.round(seg.placedStart * 1000);
      return `[${3 + i}]adelay=${delayMs}|${delayMs}[n${i}]`;
    })
    .join(";");
  const narrMixInputs = narrationSegments.map((_, i) => `[n${i}]`).join("");
  const filter = [
    `[0:a][1:a]acrossfade=d=6:c1=tri:c2=tri[x1]`,
    `[x1][2:a]acrossfade=d=6:c1=tri:c2=tri[xb]`,
    `[xb]atrim=0:${total},asetpts=N/SR/TB,volume=0.30,afade=t=in:st=0:d=2,afade=t=out:st=${fadeOutStart}:d=1.5[bed]`,
    narrLabels,
    `${narrMixInputs}amix=inputs=${narrationSegments.length}:duration=longest:normalize=0,apad=whole_dur=${total},atrim=0:${total}[narrRaw]`,
    `[narrRaw]loudnorm=I=-17:TP=-1.5:LRA=11[narr]`,
    `[narr]asplit=2[narrMix][narrKey]`,
    `[bed][narrKey]sidechaincompress=threshold=0.03:ratio=12:attack=12:release=320[bedDuck]`,
    `[bedDuck][narrMix]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[out]`,
  ].join(";");

  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", filter,
    "-map", "[out]",
    "-t", String(total),
    "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "160k",
    out,
  ]);
  console.log(`[audio] final mix → ${relative(ROOT, out)}`);
  return out;
}

// Retime the recorded beats so each narration segment gets exactly its span.
// Waits compress hard (min WAIT_MIN each), actions stay near natural speed.
function planRetime(beats, segDur, LEAD, GAP, TAIL) {
  const subs = [];
  for (let i = 0; i < beats.length - 1; i += 1) {
    const raw = beats[i + 1].t - beats[i].t;
    if (raw <= 0.05) continue;
    subs.push({ id: beats[i].id, kind: beats[i].kind, start: beats[i].t, end: beats[i + 1].t, raw });
  }
  const targets = {};
  for (let i = 0; i < SEG_IDS.length; i += 1) {
    const id = SEG_IDS[i];
    const isFirst = i === 0;
    const isLast = i === SEG_IDS.length - 1;
    targets[id] = (isFirst ? LEAD : 0) + (segDur[id] || 0) + (isLast ? TAIL : GAP);
  }
  const WAIT_MIN = 3.5;
  const plan = [];
  for (const segId of SEG_IDS) {
    const parts = SEG_MAP[segId].map((id) => subs.find((s) => s.id === id)).filter(Boolean);
    if (parts.length === 0) throw new Error(`No footage beats recorded for ${segId}`);
    const T = targets[segId];
    const actions = parts.filter((p) => p.kind === "action");
    const waits = parts.filter((p) => p.kind === "wait");
    const rawA = actions.reduce((a, p) => a + p.raw, 0);
    const rawW = waits.reduce((a, p) => a + p.raw, 0);
    let waitBudget = waits.length === 0 ? 0 : Math.max(waits.length * WAIT_MIN, T - rawA);
    if (waitBudget > T) waitBudget = T * 0.4;
    const actionBudget = T - waitBudget;
    for (const p of parts) {
      const target =
        p.kind === "wait"
          ? waitBudget * (p.raw / (rawW || 1))
          : actionBudget * (p.raw / (rawA || 1));
      plan.push({ ...p, seg: segId, target, factor: target / p.raw });
    }
  }
  return { plan, targets };
}

function writeProjectFiles({ demoVideo, demoBeats, narrationSegments, narration }) {
  const rawDuration = duration(demoVideo);
  const segDur = Object.fromEntries(narrationSegments.map((s) => [s.id, s.duration]));
  const LEAD = 0.6;
  const TAIL = 2.2;
  const SCENE_GAP = 0.45;

  // Segment layout: sequential, sized by narration.
  let cursor = 0;
  const segMeta = [];
  for (let i = 0; i < SEG_IDS.length; i += 1) {
    const id = SEG_IDS[i];
    const isFirst = i === 0;
    const isLast = i === SEG_IDS.length - 1;
    const dur = (isFirst ? LEAD : 0) + (segDur[id] || 0) + (isLast ? TAIL : SCENE_GAP);
    segMeta.push({ id, start: cursor, duration: dur });
    cursor += dur;
  }
  const total = cursor;
  console.log(
    `[timeline] ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")} — ` +
      segMeta.map((s) => `${s.id}@${s.start.toFixed(1)}s`).join(" "),
  );

  // Anchor narration to its segment start (+LEAD for the very first).
  for (const seg of narrationSegments) {
    const meta = segMeta.find((m) => m.id === seg.id);
    if (meta) seg.start = meta.start + (meta.id === SEG_IDS[0] ? LEAD : 0);
  }

  const { plan, targets } = planRetime(demoBeats, segDur, LEAD, SCENE_GAP, TAIL);
  const demoFootage = join(ASSETS, "demo-footage-fit.mp4");
  const trims = plan
    .map(
      (p, i) =>
        `[0:v]trim=start=${p.start.toFixed(3)}:end=${p.end.toFixed(3)},setpts=(PTS-STARTPTS)*${p.factor.toFixed(5)}[v${i}]`,
    )
    .join(";");
  const concatIn = plan.map((_, i) => `[v${i}]`).join("");
  const filter = `${trims};${concatIn}concat=n=${plan.length}:v=1:a=0,fps=30,format=yuv420p[v]`;
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", demoVideo,
    "-filter_complex", filter,
    "-map", "[v]", "-an",
    "-t", total.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-movflags", "+faststart",
    demoFootage,
  ]);
  for (const p of plan) {
    console.log(
      `[retime] ${p.seg}/${p.id} (${p.kind}) ${p.raw.toFixed(1)}s -> ${p.target.toFixed(1)}s (x${(1 / p.factor).toFixed(2)})`,
    );
  }
  console.log(`[video] footage ${rawDuration.toFixed(1)}s -> ${total.toFixed(1)}s across ${plan.length} beats`);

  // Fast-forward badges over compressed AI wait spans (speed >= 2x).
  let placedCursor = 0;
  const fastForwards = [];
  for (const p of plan) {
    if (p.kind === "wait" && 1 / p.factor >= 2 && p.target >= 2) {
      fastForwards.push({
        start: placedCursor,
        duration: p.target,
        speed: Math.round(1 / p.factor),
      });
    }
    placedCursor += p.target;
  }

  const audioFinal = buildFinalAudio(narrationSegments, total);

  // Subtitles 1:1 with the spoken narration: split each segment's text into
  // sentences and give each a slice of the segment's audio span proportional
  // to its character count (approximates TTS pacing).
  const subtitleCues = [];
  for (const s of narrationSegments) {
    const sentences = String(s.text || "")
      .replace(/\s+/g, "")
      .split(/(?<=[。！？；：])/)
      .map((t) => t.replace(/[。；]$/, ""))
      .filter((t) => t.length > 0);
    const totalChars = sentences.reduce((a, t) => a + t.length, 0) || 1;
    let cueStart = s.placedStart;
    for (const sentence of sentences) {
      const span = (sentence.length / totalChars) * s.duration;
      subtitleCues.push({
        text: sentence,
        start: cueStart,
        duration: Math.max(1.2, span - 0.12),
      });
      cueStart += span;
    }
  }
  const captionHtml = subtitleCues
    .map(
      (c, i) =>
        `<div id="cap-${i + 1}" class="caption clip" data-start="${c.start.toFixed(2)}" data-duration="${c.duration.toFixed(2)}" data-track-index="${100 + i}">${escapeHtml(c.text)}</div>`,
    )
    .join("\n      ");
  const captionTweens = subtitleCues
    .map(
      (c, i) =>
        `      tl.fromTo("#cap-${i + 1}", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .22, ease: "power2.out" }, ${(c.start + 0.02).toFixed(2)});`,
    )
    .join("\n");

  const chipHtml = segMeta
    .map(
      (m, i) =>
        `<div id="chip-${i + 1}" class="step-chip clip" data-start="${m.start.toFixed(2)}" data-duration="${m.duration.toFixed(2)}" data-track-index="${10 + i}">${escapeHtml(STEP_CHIP[m.id])}</div>`,
    )
    .join("\n      ");
  const chipTweens = segMeta
    .map(
      (m, i) =>
        `      tl.fromTo("#chip-${i + 1}", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: .4, ease: "power3.out" }, ${(m.start + 0.05).toFixed(2)});`,
    )
    .join("\n");

  const calloutSegs = narrationSegments.filter((s) => CALLOUT_TEXT[s.id]);
  const callouts = calloutSegs
    .map(
      (s, i) =>
        `<div id="call-${i + 1}" class="callout clip" data-start="${(s.placedStart + 0.8).toFixed(2)}" data-duration="${Math.max(5, s.duration - 1.6).toFixed(2)}" data-track-index="${30 + i}">${escapeHtml(CALLOUT_TEXT[s.id])}</div>`,
    )
    .join("\n      ");
  const calloutTweens = calloutSegs
    .map(
      (s, i) =>
        `      tl.fromTo("#call-${i + 1}", { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: .45, ease: "expo.out" }, ${(s.placedStart + 0.9).toFixed(2)});`,
    )
    .join("\n");

  const ffHtml = fastForwards
    .map(
      (f, i) =>
        `<div id="ff-${i + 1}" class="ff-badge clip" data-start="${f.start.toFixed(2)}" data-duration="${f.duration.toFixed(2)}" data-track-index="${70 + i}">&#9193; AI 处理中 · 快进 ${f.speed}×</div>`,
    )
    .join("\n      ");
  const ffTweens = fastForwards
    .map(
      (f, i) =>
        `      tl.fromTo("#ff-${i + 1}", { opacity: 0, scale: .92 }, { opacity: 1, scale: 1, duration: .3, ease: "power2.out" }, ${(f.start + 0.05).toFixed(2)});`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        overflow: hidden;
        background: #0d1622;
        color: #142333;
        font-family: sans-serif;
      }
      .clip { position: absolute; inset: 0; width: 100%; height: 100%; }
      .demo-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .step-chip {
        inset: 28px auto auto 32px;
        width: max-content;
        height: auto;
        padding: 12px 24px;
        background: rgba(12,20,31,.92);
        color: #fff;
        border-left: 7px solid #1f6feb;
        font-size: 26px;
        font-weight: 900;
        letter-spacing: .5px;
        border-radius: 10px;
        box-shadow: 0 14px 40px rgba(0,0,0,.30);
      }
      .callout {
        inset: auto auto 148px 32px;
        width: auto;
        height: auto;
        max-width: 640px;
        padding: 18px 26px;
        background: rgba(255,255,255,.97);
        border-left: 9px solid #1f9d57;
        color: #142333;
        font-size: 28px;
        line-height: 1.35;
        font-weight: 900;
        border-radius: 6px;
        box-shadow: 0 22px 58px rgba(0,0,0,.26);
      }
      .ff-badge {
        inset: 30px 36px auto auto;
        left: auto;
        width: max-content;
        height: auto;
        padding: 10px 20px;
        background: rgba(31,111,235,.94);
        color: #fff;
        font-size: 24px;
        font-weight: 900;
        letter-spacing: 1px;
        border-radius: 999px;
        box-shadow: 0 12px 34px rgba(0,0,0,.30);
      }
      .caption {
        left: 0;
        right: 0;
        top: auto;
        bottom: 36px;
        margin-left: auto;
        margin-right: auto;
        width: max-content;
        max-width: 1400px;
        height: auto;
        padding: 15px 40px;
        background: rgba(12,20,31,.93);
        color: #fff;
        font-size: 29px;
        line-height: 1.34;
        font-weight: 900;
        text-align: center;
        border-radius: 15px;
        box-shadow: 0 16px 50px rgba(0,0,0,.30);
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${WIDTH}" data-height="${HEIGHT}">
      <video id="demo-video" class="demo-video clip" data-start="0" data-duration="${total}" data-track-index="1" src="assets/demo-footage-fit.mp4" muted playsinline></video>
      ${chipHtml}
      ${callouts}
      ${ffHtml}
      ${captionHtml}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#demo-video", { opacity: 0 }, { opacity: 1, duration: .6, ease: "sine.out" }, 0);
${chipTweens}
${calloutTweens}
${ffTweens}
${captionTweens}
      tl.to("#demo-video", { opacity: 0, duration: .9, ease: "sine.inOut" }, ${(total - 1.0).toFixed(2)});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

  writeFileSync(join(PROJECT, "index.html"), html, "utf8");
  writeFileSync(
    join(PROJECT, "hyperframes.json"),
    JSON.stringify(
      {
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
        paths: { blocks: "compositions", components: "compositions/components", assets: "assets" },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(PROJECT, "package.json"),
    JSON.stringify(
      {
        name: "jiaxu-full-demo",
        private: true,
        type: "module",
        scripts: {
          check: `npx --yes hyperframes@${HF_VERSION} lint && npx --yes hyperframes@${HF_VERSION} validate && npx --yes hyperframes@${HF_VERSION} inspect`,
          render: `npx --yes hyperframes@${HF_VERSION} render --output ../full-demo.mp4 --fps 30 --quality high`,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(PROJECT, "meta.json"),
    JSON.stringify(
      {
        id: "jiaxu-full-demo-v1",
        name: "价序 全功能演示（培训版 · 纯点击流）",
        createdAt: new Date().toISOString(),
        duration: total,
        baseUrl: BASE,
        ttsProvider: TTS_PROVIDER,
        ttsVoice: TTS_VOICE,
        rawDemoDuration: rawDuration,
        narrationSegments: narrationSegments.map((s) => ({ id: s.id, start: s.start, duration: Number(s.duration.toFixed(2)) })),
        narrationCharacters: narration.length,
        segments: segMeta.map((s) => ({ id: s.id, start: Number(s.start.toFixed(2)), duration: Number(s.duration.toFixed(2)) })),
        demoBeats,
        retime: plan.map((p) => ({
          seg: p.seg,
          beat: p.id,
          kind: p.kind,
          raw_s: Number(p.raw.toFixed(2)),
          target_s: Number(p.target.toFixed(2)),
          speed_x: Number((1 / p.factor).toFixed(2)),
        })),
        targets,
        hyperframesVersion: HF_VERSION,
      },
      null,
      2,
    ),
    "utf8",
  );
  return { total, retimePlan: plan, rawDuration, narrationSegments, audioFinal, segMeta };
}

function inspectSampleTimes(meta) {
  const times = [];
  for (const seg of meta.segMeta) {
    times.push(seg.start + seg.duration * 0.35, seg.start + seg.duration * 0.75);
  }
  return times
    .map((t) => Math.min(t, meta.total - 0.5))
    .sort((x, y) => x - y)
    .map((t) => t.toFixed(2))
    .join(",");
}

function renderVideo(meta) {
  const rendered = join(OUT, "full-demo-rendered.mp4");
  const final = join(OUT, "full-demo.mp4");
  const reuseRender = process.env.REUSE_RENDER === "1" && existsSync(rendered);

  if (reuseRender) {
    console.log(`[video] REUSE_RENDER=1 → reusing ${relative(ROOT, rendered)}`);
  } else {
    run("npx", [...HF, "lint", PROJECT]);
    run("npx", [...HF, "validate", PROJECT]);
    const sampleTimes = inspectSampleTimes(meta);
    console.log(`[inspect] sampling at ${sampleTimes}`);
    const inspect = spawnSync("npx", [...HF, "inspect", PROJECT, "--at", sampleTimes, "--json"], {
      encoding: "utf8",
    });
    writeFileSync(join(QA, "hyperframes-inspect.json"), inspect.stdout || inspect.stderr || "", "utf8");
    if (inspect.status !== 0) {
      console.error(inspect.stdout);
      console.error(inspect.stderr);
      throw new Error("HyperFrames inspect failed.");
    }
    if (process.env.SKIP_RENDER === "1") {
      console.log("[video] SKIP_RENDER=1 → stopping before render.");
      return null;
    }
    run("npx", [...HF, "render", PROJECT, "--output", rendered, "--fps", "30", "--quality", "high"]);
  }

  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", rendered,
    "-i", meta.audioFinal,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-preset", "slow",
    "-b:v", "5000k",
    "-minrate", "5000k",
    "-maxrate", "5000k",
    "-bufsize", "10000k",
    "-x264-params", "nal-hrd=cbr:force-cfr=1",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-g", "30",
    "-keyint_min", "30",
    "-sc_threshold", "0",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    "-shortest",
    final,
  ]);
  return final;
}

function extractKeyframes(videoPath, meta) {
  const framesDir = join(QA, "frames");
  mkdirSync(framesDir, { recursive: true });
  const shots = [];
  for (const seg of meta.segMeta) {
    for (const f of [0.35, 0.8]) {
      shots.push({ id: `${seg.id}-${Math.round(f * 100)}`, t: seg.start + seg.duration * f });
    }
  }
  for (const shot of shots) {
    const outPath = join(framesDir, `${shot.id}.png`);
    run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", shot.t.toFixed(2),
      "-i", videoPath,
      "-frames:v", "1",
      outPath,
    ]);
  }
  console.log(`[qa] ${shots.length} keyframes → ${relative(ROOT, framesDir)}`);
  return framesDir;
}

function qaVideo(videoPath, meta) {
  const probe = mediaInfo(videoPath);
  writeFileSync(join(QA, "ffprobe.json"), JSON.stringify(probe, null, 2), "utf8");

  const black = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", videoPath, "-vf", "blackdetect=d=0.4:pix_th=0.10", "-an", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  writeFileSync(join(QA, "blackdetect.log"), `${black.stdout || ""}${black.stderr || ""}`, "utf8");

  const videoStream = probe.streams.find((s) => s.codec_name === "h264") ?? probe.streams[0];
  const size = Number(probe.format.size || 0);
  const dur = Number(probe.format.duration || 0);
  const speeds = meta.retimePlan.map((p) => 1 / p.factor);
  const summary = {
    video: relative(ROOT, videoPath),
    width: videoStream.width,
    height: videoStream.height,
    fps: videoStream.avg_frame_rate,
    duration_s: Number(dur.toFixed(2)),
    estimated_bitrate_mbps: Number(((size * 8) / dur / 1_000_000).toFixed(2)),
    has_aac_audio: probe.streams.some((s) => s.codec_name === "aac"),
    raw_footage_s: Number(meta.rawDuration.toFixed(2)),
    narration_s: Number(meta.narrationSegments.reduce((a, s) => a + s.duration, 0).toFixed(2)),
    narration_coverage_pct: Number(
      ((meta.narrationSegments.reduce((a, s) => a + s.duration, 0) / meta.total) * 100).toFixed(1),
    ),
    segments: meta.segMeta.map((s) => ({ id: s.id, start_s: Number(s.start.toFixed(2)), duration_s: Number(s.duration.toFixed(2)) })),
    retime_speed_min_x: Number(Math.min(...speeds).toFixed(2)),
    retime_speed_max_x: Number(Math.max(...speeds).toFixed(2)),
    path: "landing → workspace(run①→提案卡→人审→政策上传→run②漂移→规则→run③自动) → 待办核验 → 批次 → 监测 → 结果单（全程点击）",
  };
  writeFileSync(join(QA, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log("[video] QA summary", summary);
}

async function main() {
  const reusableFootage = join(OUT, "_reuse-full-footage.mp4");
  const reusableBeats = join(OUT, "_reuse-full-beats.json");
  const existingFootage = join(ASSETS, "demo-footage.mp4");
  const existingBeats = join(ASSETS, "demo-beats.json");
  if (REUSE_DEMO_FOOTAGE && existsSync(existingFootage) && existsSync(existingBeats)) {
    copyFileSync(existingFootage, reusableFootage);
    copyFileSync(existingBeats, reusableBeats);
  }
  clean();
  let demoVideo;
  let demoBeats;
  if (existsSync(reusableFootage) && existsSync(reusableBeats)) {
    const target = join(ASSETS, "demo-footage.mp4");
    copyFileSync(reusableFootage, target);
    copyFileSync(reusableBeats, join(ASSETS, "demo-beats.json"));
    demoBeats = JSON.parse(readFileSync(reusableBeats, "utf8")).beats;
    rmSync(reusableFootage, { force: true });
    rmSync(reusableBeats, { force: true });
    demoVideo = target;
    console.log("[footage] REUSE_DEMO_FOOTAGE=1 → reusing previous footage + beats");
  } else {
    const rec = await recordProductFootage();
    demoVideo = rec.raw;
    demoBeats = rec.beats;
  }
  const { segments: narrationSegments, narration } = await generateAudio();
  const meta = writeProjectFiles({ demoVideo, demoBeats, narrationSegments, narration });
  const videoPath = renderVideo(meta);
  if (!videoPath) return;
  qaVideo(videoPath, meta);
  extractKeyframes(videoPath, meta);
  rmSync(WORK, { recursive: true, force: true });
  console.log("[video] done ->", videoPath);
}

main().catch((e) => {
  console.error("[video] error:", e);
  process.exit(1);
});
