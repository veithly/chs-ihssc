#!/usr/bin/env node
// Build the canonical HackathonHunter Pitch + Demo video for 价序 (V2.2).
//
// Story: 政策变更后的存量机构执行价复核 Agent。
// Killer loop on camera: run① 基线核价 → 人审 2 条涨幅异常
// → 政策同步（真实抓取国家医保局公告）→ 公告人审确认 640→560
// → run② 漂移检出 + 复核任务 → 人审处置 → 规则挖掘 → dry-run → 激活
// → run③ 同类项自动处置 → 审计日志。
//
// Pipeline:
// 1) record real 1080p browser footage from / (landing) → /workspace,
//    logging beat marks (action vs provider-wait) with wall-clock timestamps
// 2) retime footage per beat: provider waits compress hard, clicks stay ~1x,
//    each demo narration segment gets exactly its narration-sized span
// 3) generate zh-CN narration from docs/video/pitch-demo-narration.txt
// 4) write a HyperFrames composition (narration-driven timeline, < 5min)
// 5) lint, validate, inspect, render, mux BGM+narration, then ffmpeg media QA
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
const BASE = process.env.DEMO_URL?.replace(/\/$/, "") || "http://127.0.0.1:3400";
const OUT = join(ROOT, "docs", "video");
const PROJECT = join(OUT, "pitch-demo");
const ASSETS = join(PROJECT, "assets");
const QA = join(PROJECT, "qa");
const WORK = join(OUT, "_work");
const NARRATION_SOURCE = join(OUT, "pitch-demo-narration.txt");
const WIDTH = 1920;
const HEIGHT = 1080;
const TARGET_DURATION = Number(process.env.VIDEO_TARGET_DURATION || 300);
const HF_VERSION = process.env.HYPERFRAMES_VERSION || "0.7.5";
const HF = ["--yes", `hyperframes@${HF_VERSION}`];
const TTS_PROVIDER = process.env.TTS_PROVIDER || "say";
const TTS_VOICE = process.env.TTS_VOICE || "Tingting";
const TTS_RATE = process.env.TTS_RATE || "165";
// Background music: prefer the hackathonhunter skill's rights-cleared tracks.
// Override with BGM_DIR. Synthesised beds are intentionally not used (skill pitfall P-34).
const BGM_DIR =
  process.env.BGM_DIR ||
  join(ROOT, "..", "..", "..", "..", ".claude", "skills", "hackathonhunter", "assets", "music");
const BGM_INTRO = process.env.BGM_INTRO || "01_future_forward.mp3";
const BGM_MID = process.env.BGM_MID || "02_innovation_drive.mp3";
const REUSE_DEMO_FOOTAGE = process.env.REUSE_DEMO_FOOTAGE === "1";

const HERO_PROMPT_KEY = "drift_review_loop";

// Captions are derived 1:1 from the narration segments (see writeProjectFiles), so
// each subtitle is locked to the voice line it paraphrases — no hand-tuned timestamps.
const CAPTION_TEXT = {
  s1: "政策变了，存量执行价还合不合规，价序来管",
  s2: "政策跟不住 · 审批负担重，一线的两句原话",
  s3: "首页一个入口：核完并闭环处置这批执行价异常",
  demo1: "真实模型核价 · 2452号差比价折算 · 拿不准转人审",
  demo2: "真实抓取医保局公告 · 人审确认 640→560 · 漂移检出",
  demo3: "人审选处置动作，写进不可变决策日志",
  demo4: "人审反馈挖掘规则 · dry-run 影响面 · 人工激活",
  demo5: "命中规则自动处置，敏感项永远人审",
  demo6: "批次闸门：苏医保发64号红黄分档 · 每条异常带文号出证",
  s5: "六类业务对象落 SQLite，效能实时可对账",
  s6a: "模型出计划，服务端管状态，每步可回放",
  s6b: "红线：发函、通报、违规认定必须人点头",
  s7: "verify:v2 一条命令 17 项全绿，评委可复跑",
};
// Short on-footage pointers during the demo (one per demo narration segment).
const CALLOUT_TEXT = {
  demo1: "真实 run · 差比价折算 · 政策版本指纹",
  demo2: "政策同步 → 公告人审确认 → 漂移队列",
  demo3: "批准处置 → 决策日志",
  demo4: "挖掘 → 影响面 → 激活",
  demo5: "自动处置 · 审计留痕",
  demo6: "红黄预警分档 · 差比价折算超限",
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
  await resetSamples();
  // Pre-create the workspace thread + demo dataset over the API. The landing
  // deep-link then runs on this same thread, and the recorder can inspect it
  // (which tasks are price_spike) while the camera rolls.
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

  // Provider waits stay visually still (running badge + optimistic message carry
  // the motion); the retime pass compresses these spans hard, so any scroll
  // jiggle here would turn into visible shaking.
  async function idleUntil(promise) {
    return promise;
  }

  // Optional camera moves must fail fast: page.setDefaultTimeout is sized for
  // provider runs, and a missing hover target must not stall the recording.
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
    await wait(950);
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
    await wait(900);
  }

  // ---- beat b0: landing → hero prompt deep-link -----------------------------
  mark("b0-landing", "action");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-landing-hero]");
  await wait(2300);
  const heroChip = page.locator(
    `[data-prompt-rail] [data-prompt-chip][data-prompt-key="${HERO_PROMPT_KEY}"]`,
  );
  await heroChip.scrollIntoViewIfNeeded().catch(() => {});
  await heroChip.hover().catch(() => {});
  await wait(900);
  const runWait1 = nextRunResponse();
  await heroChip.click();
  await page.waitForURL(/\/workspace\?prompt=/, { timeout: 20000 });
  await page.waitForSelector("[data-conversation-composer]", { timeout: 30000 });
  await wait(800);

  // ---- beat b1: run① (live provider) then review + approve 2 spikes ---------
  mark("b1-run1", "wait");
  await idleUntil(runWait1);
  await wait(1600);

  mark("b1-result", "action");
  await page.mouse.wheel(0, 420);
  await wait(1400);
  await page.mouse.wheel(0, 420);
  await wait(1300);
  await page.mouse.wheel(0, -700);
  await wait(1000);
  const spikes1 = await spikeTaskTitles(threadId);
  console.log(`[footage] run1 spike tasks: ${spikes1.map((s) => s.title).join(" | ")}`);
  await openObjectTab("人审任务");
  let approvedOnCamera = 0;
  for (const spike of spikes1.slice(0, 2)) {
    if (await approveTaskRow(spike, 2100)) approvedOnCamera += 1;
  }
  await wait(700);

  // ---- beat b2: 政策获取（真实抓取公告）→ 公告人审确认 640→560 → 重跑 --------
  mark("b2-policy", "action");
  await openObjectTab("政策事实");
  await wait(1400);
  // 1) 政策同步：真实抓取国家医保局公开公告 → artifact 落库（hash 留痕）
  let confirmedViaArtifact = false;
  const syncBtn = page.locator("[data-policy-sync]");
  if ((await syncBtn.count()) > 0) {
    await syncBtn.hover(QUICK).catch(() => {});
    await wait(600);
    await syncBtn.click(QUICK).catch(() => {});
    const gotArtifacts = await page
      .waitForSelector("[data-artifact-row]", { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (gotArtifacts) {
      await wait(1000);
      await glance(page.locator("[data-policy-source]"));
      await wait(1100);
      const firstArtifact = page.locator("[data-artifact-row]").first();
      await glance(firstArtifact);
      await wait(1400);
      // 2) 公告人审确认：录入 HC-LNS-902 / 560 → 政策事实生效（真实产品链路）
      await firstArtifact.locator("[data-artifact-open-confirm]").click(QUICK).catch(() => {});
      const formVisible = await page
        .waitForSelector("[data-artifact-confirm]", { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (formVisible) {
        await wait(1800); // 停在预填的 HC-LNS-902 / 560 上，让观众看清人审录入
        const submit = page.locator("[data-artifact-confirm-submit]");
        await submit.hover(QUICK).catch(() => {});
        await wait(500);
        await submit.click(QUICK).catch(() => {});
        confirmedViaArtifact = await page
          .waitForFunction(
            () => (document.querySelector("[data-policy-msg]")?.textContent ?? "").includes("生效"),
            undefined,
            { timeout: 15000 },
          )
          .then(() => true)
          .catch(() => false);
        await wait(2200);
      }
    }
  }
  if (!confirmedViaArtifact) {
    // 兜底：公开站点不可达时，退回确定性的政策变更演示按钮
    console.warn("[footage] policy sync/confirm unavailable → falling back to demo policy update");
    const policyBtn = page.locator("[data-demo-policy-update]");
    await policyBtn.hover(QUICK).catch(() => {});
    await wait(700);
    await policyBtn.click();
    await page
      .waitForSelector("[data-policy-msg]", { timeout: 15000 })
      .catch(() => {});
    await wait(2600);
  }
  const runWait2 = nextRunResponse();
  await page.locator(`[data-prompt-chip][data-prompt-key="${HERO_PROMPT_KEY}"]`).click();
  await wait(400);

  mark("b2-wait", "wait");
  await idleUntil(runWait2);
  await wait(1700);

  mark("b2-drift", "action");
  // runInstruction auto-switches to the drift queue when the run detected drifts.
  await page.waitForSelector("[data-drift-row]", { timeout: 20000 }).catch(() => {});
  await wait(1900);
  await glance(page.locator("[data-drift-row]").first());
  await wait(2100);
  await page.mouse.wheel(0, 300);
  await wait(1900);
  await glance(page.locator("[data-drift-row]").nth(2));
  await wait(1900);
  await page.mouse.wheel(0, 260);
  await wait(1800);
  await page.mouse.wheel(0, -420);
  await wait(1400);

  // ---- beat b3: human review (2 spikes + 1 drift-review task) ---------------
  mark("b3-review", "action");
  // Kick the release-gate scan now: beats b3/b4 are provider-free (deterministic
  // mining/dry-run), so this live-provider call runs in a quiet window and its
  // result page is ready when the camera reaches beat b6.
  const releaseScanPromise = api("POST", "/api/agent/release-gate", {
    releaseId: "REL-2026-0623-07",
  });
  const spikes2 = await spikeTaskTitles(threadId);
  console.log(`[footage] run2 spike tasks: ${spikes2.map((s) => s.title).join(" | ")}`);
  await openObjectTab("人审任务");
  await wait(1100);
  for (const spike of spikes2.slice(0, 2)) {
    if (await approveTaskRow(spike, 2500)) approvedOnCamera += 1;
  }
  await approveTaskRow("政策漂移复核", 2500);
  // Linger on the decided rows: the narration is talking about the immutable
  // decision log entry right now.
  await glance(page.locator(".task-final").first());
  await wait(2400);
  // The learned pattern needs support >= 3; top up over the API only if the
  // on-camera clicks somehow missed (rows out of view etc).
  if (approvedOnCamera < 3) {
    const rest = await spikeTaskTitles(threadId);
    for (const spike of rest.slice(0, 3 - approvedOnCamera)) {
      await api("POST", `/api/workspace/tasks/${spike.id}/decision`, {
        decision: "approve",
        final_action: "机构核实",
        reviewer: "价格治理审核员",
        notes: "补充演示决策",
      });
    }
  }
  await wait(600);

  // ---- beat b4: mine → dry-run → activate -----------------------------------
  mark("b4-rules", "action");
  await openObjectTab("规则候选");
  await wait(1200);
  const mineBtn = page.locator("button", { hasText: "从人审反馈挖掘候选" }).first();
  await mineBtn.hover(QUICK).catch(() => {});
  await wait(700);
  await mineBtn.click();
  await page.waitForSelector("[data-rule-candidate]", { timeout: 20000 });
  await wait(2100);
  const candidate = page.locator("[data-rule-candidate]").first();
  await glance(candidate.locator(".rc-trigger"));
  await wait(1500);
  await glance(candidate.locator(".rc-src"));
  await wait(1700);
  const dryBtn = candidate.locator("button", { hasText: "影响面预览" }).first();
  await dryBtn.hover(QUICK).catch(() => {});
  await wait(500);
  await dryBtn.click(QUICK).catch(() => {});
  await page.waitForSelector("[data-rule-dryrun]", { timeout: 15000 }).catch(() => {});
  await wait(1400);
  await glance(candidate.locator("[data-rule-dryrun]"));
  await wait(2600);
  const activateBtn = candidate.locator(".mini-btn.approve", { hasText: "激活" }).first();
  await activateBtn.hover(QUICK).catch(() => {});
  await wait(600);
  await activateBtn.click();
  await page.waitForSelector("[data-active-rule]", { timeout: 15000 }).catch(() => {});
  await wait(1500);
  await glance(page.locator("[data-active-rule]").first());
  await wait(2300);

  // ---- beat b5: run③ — learned rule auto-disposes, audit strip --------------
  const runWait3 = nextRunResponse();
  await page.locator(`[data-prompt-chip][data-prompt-key="${HERO_PROMPT_KEY}"]`).click();
  await wait(300);
  mark("b5-wait", "wait");
  await idleUntil(runWait3);
  await wait(1700);

  mark("b5-auto", "action");
  await openObjectTab("人审任务");
  await wait(1100);
  await glance(page.locator('[data-task-row][data-task-status="自动处置"]').first());
  await wait(2700);
  // Sensitive rows stay in human review — hover one undecided row while the
  // narration says "敏感的永远留在人审".
  await glance(page.locator('[data-task-row]:not([data-task-status="自动处置"])').first());
  await wait(2200);
  await glance(page.locator("[data-audit-strip]"));
  await wait(3000);
  await page.mouse.wheel(0, -900);
  await wait(2500);

  // ---- beat b6: whole-batch gate result — 差比价折算 + 64号红黄分档 -----------
  mark("b6-wait", "wait");
  let scan = await releaseScanPromise.catch(() => null);
  if (!scan?.ok) {
    console.warn(
      `[footage] release-gate scan degraded (${scan?.error_category ?? "unknown"}) → retrying once`,
    );
    scan = await api("POST", "/api/agent/release-gate", { releaseId: "REL-2026-0623-07" });
  }
  if (!scan?.ok) {
    throw new Error(`Release-gate scan failed twice (${scan?.error_category ?? "unknown"}); beat b6 needs a successful run.`);
  }

  mark("b6-release", "action");
  await page.goto(`${BASE}/release/REL-2026-0623-07/result`, { waitUntil: "networkidle" });
  await page.waitForSelector(".dist-grid", { timeout: 20000 });
  await wait(2000);
  // Issue-type chips: 差比价折算超限 / 超过最高有效价 land here.
  await glance(page.locator(".result-issue-badges"));
  await wait(1800);
  const affectedTable = page.locator(".batch-scroll").first();
  await affectedTable.scrollIntoViewIfNeeded(QUICK).catch(() => {});
  await wait(1300);
  // 苏医保发〔2021〕64号分档徽标：黄色预警 → 红色预警★★★（10倍以上，停采档）。
  await glance(page.locator(".batch-table tr", { hasText: "红色预警" }).first());
  await wait(2400);
  await glance(page.locator(".batch-table tr", { hasText: "差比价折算超限" }).first());
  await wait(2400);
  await page.mouse.wheel(0, -500);
  await wait(1600);

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
  if (segments.length === 0) {
    throw new Error("Narration has no [scene:start-end] segments.");
  }
  console.log(`[narration] ${segments.length} segment(s): ${segments.map((s) => s.id).join(", ")}`);

  if (TTS_PROVIDER === "say") {
    return generateSayAudioSegments(segments);
  }
  if (TTS_PROVIDER === "mimo") {
    return generateMimoAudioSegments(segments);
  }
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
    out.push({ id: seg.id, start: seg.start, end: seg.end, file: m4a, duration: duration(m4a) });
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
        console.log(`[mimo]   chunk ${i + 1}/${subChunks.length} cached`);
        subFiles.push(outPath);
        continue;
      }
      const body = buildMimoBody({ model, voice: voiceName, format, instruction, text });
      console.log(`[mimo]   chunk ${i + 1}/${subChunks.length} ${text.length} chars → ${relative(ROOT, outPath)}`);
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
        throw new Error(`MiMo TTS ${seg.id} chunk ${i + 1} returned no audio data. Response: ${JSON.stringify(json).slice(0, 400)}`);
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
    out.push({ id: seg.id, start: seg.start, end: seg.end, file: segM4a, duration: duration(segM4a) });
    console.log(`[mimo] segment ${seg.id} done ${out[out.length - 1].duration.toFixed(2)}s (window ${seg.start}-${seg.end}s)`);
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
    // Paragraph itself too long: split on sentence boundaries.
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
  return {
    model,
    messages,
    audio: { format, voice },
  };
}

function copyBrand() {
  copyFileSync(join(ROOT, "public", "brand", "logomark.svg"), join(ASSETS, "logomark.svg"));
  copyFileSync(join(ROOT, "public", "brand", "logo-mono.svg"), join(ASSETS, "logo-mono.svg"));
  copyFileSync(join(ROOT, "public", "brand", "wordmark.svg"), join(ASSETS, "wordmark.svg"));
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
    throw new Error(
      `Missing BGM tracks. Expected ${relative(ROOT, intro)} and ${relative(ROOT, mid)}. Set BGM_DIR to the hackathonhunter assets/music folder.`,
    );
  }

  // Copy the tracks into the project so the repo is self-contained.
  const introCopy = join(ASSETS, "bgm-intro.mp3");
  const midCopy = join(ASSETS, "bgm-mid.mp3");
  copyFileSync(intro, introCopy);
  copyFileSync(mid, midCopy);

  const out = join(ASSETS, "audio-final.m4a");
  const fadeOutStart = Math.max(0, total - 1.5).toFixed(2);

  // Sequential placement: each segment starts no earlier than its scene anchor (seg.start),
  // but always after the previous segment finishes (+ small breath). This keeps narration
  // continuous — no big blank stretches — while guaranteeing voices never overlap.
  const GAP = 0.4;
  let cursor = 0;
  for (const seg of narrationSegments) {
    const placedStart = Math.max(seg.start, cursor);
    seg.placedStart = placedStart;
    cursor = placedStart + seg.duration + GAP;
  }
  if (cursor > total + 0.5) {
    console.warn(`[audio] narration packs to ${cursor.toFixed(1)}s > ${total}s; tail may be trimmed. Consider shortening segments.`);
  }

  // BGM bed: intro -> (crossfade) mid -> (crossfade) intro again as outro, trimmed to `total`.
  // Then duck the bed under narration via sidechaincompress and mix the scene-aligned narration on top.
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
    `[xb]atrim=0:${total},asetpts=N/SR/TB,volume=0.34,afade=t=in:st=0:d=2,afade=t=out:st=${fadeOutStart}:d=1.5[bed]`,
    narrLabels,
    `${narrMixInputs}amix=inputs=${narrationSegments.length}:duration=longest:normalize=0,apad=whole_dur=${total},atrim=0:${total}[narrRaw]`,
    `[narrRaw]loudnorm=I=-17:TP=-1.5:LRA=11[narr]`,
    `[narr]asplit=2[narrMix][narrKey]`,
    `[bed][narrKey]sidechaincompress=threshold=0.03:ratio=12:attack=12:release=320[bedDuck]`,
    `[bedDuck][narrMix]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[out]`,
  ].join(";");

  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-t",
    String(total),
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    out,
  ]);
  console.log(`[audio] final mix → ${relative(ROOT, out)} (BGM: ${BGM_INTRO} + ${BGM_MID}, ${narrationSegments.length} narration segments, sidechain-ducked)`);
  return out;
}

// Map recorded beats to the five demo narration segments and retime each
// sub-beat: provider waits compress to a short on-screen pause, click/action
// beats stay near natural speed, and every segment lands exactly on the span
// its narration needs.
function planDemoRetime(beats, segDur, LEAD, GAP, TAIL) {
  const subs = [];
  for (let i = 0; i < beats.length - 1; i += 1) {
    const raw = beats[i + 1].t - beats[i].t;
    if (raw <= 0.05) continue;
    subs.push({ id: beats[i].id, kind: beats[i].kind, start: beats[i].t, end: beats[i + 1].t, raw });
  }
  const segMap = {
    demo1: ["b0-landing", "b1-run1", "b1-result"],
    demo2: ["b2-policy", "b2-wait", "b2-drift"],
    demo3: ["b3-review"],
    demo4: ["b4-rules"],
    demo5: ["b5-wait", "b5-auto"],
    demo6: ["b6-wait", "b6-release"],
  };
  const targets = {
    demo1: LEAD + (segDur.demo1 || 0) + GAP,
    demo2: (segDur.demo2 || 0) + GAP,
    demo3: (segDur.demo3 || 0) + GAP,
    demo4: (segDur.demo4 || 0) + GAP,
    demo5: (segDur.demo5 || 0) + GAP,
    demo6: (segDur.demo6 || 0) + TAIL,
  };
  const WAIT_MIN = 2.2;
  const plan = [];
  for (const segId of Object.keys(segMap)) {
    const parts = segMap[segId].map((id) => subs.find((s) => s.id === id)).filter(Boolean);
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

  // --- Narration-driven timeline -------------------------------------------
  // Every non-demo scene is sized to its own narration: a short lead-in, the
  // speech itself, then a small tail before it cuts straight to the next scene.
  // Nothing is padded to reach a fixed 5:00 — the total floats to whatever the
  // narration needs and stays under five minutes. The demo block is sized to its
  // narration and the real footage is retimed per beat to fill it, so the
  // picture and the voice describing it stay locked together.
  const segDur = Object.fromEntries(narrationSegments.map((s) => [s.id, s.duration]));
  const sum = (...ids) => ids.reduce((a, id) => a + (segDur[id] || 0), 0);
  const LEAD = 0.35;
  const TAIL = 1.5;
  const SCENE_GAP = 0.4;
  const sceneDur = (...ids) => LEAD + sum(...ids) + Math.max(0, ids.length - 1) * SCENE_GAP + TAIL;

  const s1Start = 0;
  const s1Duration = sceneDur("s1");
  const s2Start = s1Start + s1Duration;
  const s2Duration = sceneDur("s2");
  const s3Start = s2Start + s2Duration;
  const s3Duration = sceneDur("s3");

  const demoStart = s3Start + s3Duration;
  const demoDuration =
    LEAD + sum("demo1", "demo2", "demo3", "demo4", "demo5", "demo6") + 5 * SCENE_GAP + TAIL;

  const resultStart = demoStart + demoDuration;
  const resultDuration = sceneDur("s5");
  const mechanismStart = resultStart + resultDuration;
  const mechanismDuration = sceneDur("s6a", "s6b");
  const closeStart = mechanismStart + mechanismDuration;
  const closeDuration = sceneDur("s7");
  const total = closeStart + closeDuration;
  const runtimeLabel = `${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}`;

  // Re-anchor every narration line onto the scene it belongs to; the sequential
  // packer in buildFinalAudio then lands each voice line on its own scene.
  const anchors = {
    s1: s1Start + LEAD, s2: s2Start + LEAD, s3: s3Start + LEAD,
    demo1: demoStart + LEAD, demo2: demoStart + LEAD, demo3: demoStart + LEAD,
    demo4: demoStart + LEAD, demo5: demoStart + LEAD, demo6: demoStart + LEAD,
    s5: resultStart + LEAD, s6a: mechanismStart + LEAD, s6b: mechanismStart + LEAD,
    s7: closeStart + LEAD,
  };
  for (const seg of narrationSegments) {
    if (anchors[seg.id] != null) seg.start = anchors[seg.id];
  }

  // Retime the real browser footage beat by beat so each demo narration line
  // plays over the footage of exactly that step (waits compressed, clicks ~1x).
  const { plan, targets } = planDemoRetime(demoBeats, segDur, LEAD, SCENE_GAP, TAIL);
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
    "-t", demoDuration.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    // Dense keyframes: HyperFrames seeks per-frame; sparse GOPs freeze the picture.
    "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-movflags", "+faststart",
    demoFootage,
  ]);
  for (const p of plan) {
    console.log(
      `[retime] ${p.seg}/${p.id} (${p.kind}) ${p.raw.toFixed(1)}s -> ${p.target.toFixed(1)}s (x${(1 / p.factor).toFixed(2)} speed)`,
    );
  }
  console.log(`[video] demo footage ${rawDuration.toFixed(1)}s -> ${demoDuration.toFixed(1)}s across ${plan.length} beats`);

  const audioFinal = buildFinalAudio(narrationSegments, total);

  // Captions: 1:1 with narration segments, each locked to its placed voice line.
  const captionSegs = narrationSegments.filter((s) => CAPTION_TEXT[s.id]);
  const captionHtml = captionSegs
    .map(
      (s, i) =>
        `<div id="cap-${i + 1}" class="caption clip" data-start="${s.placedStart.toFixed(2)}" data-duration="${Math.max(2.6, s.duration - 0.25).toFixed(2)}" data-track-index="${30 + i}">${escapeHtml(CAPTION_TEXT[s.id])}</div>`,
    )
    .join("\n      ");
  const captionTweens = captionSegs
    .map(
      (s, i) =>
        `      tl.fromTo("#cap-${i + 1}", { opacity: 0, y: 24, scale: .985 }, { opacity: 1, y: 0, scale: 1, duration: .34, ease: "power3.out" }, ${(s.placedStart + 0.1).toFixed(2)});`,
    )
    .join("\n");

  // Callouts: short on-footage pointers, one per demo narration segment.
  const calloutSegs = narrationSegments.filter((s) => CALLOUT_TEXT[s.id]);
  const calloutAxes = ["x", "y", "x", "y", "x"];
  const callouts = calloutSegs
    .map(
      (s, i) =>
        `<div id="call-${i + 1}" class="callout clip" data-start="${(s.placedStart + 0.6).toFixed(2)}" data-duration="${Math.max(6, s.duration - 1.2).toFixed(2)}" data-track-index="${12 + i}">${escapeHtml(CALLOUT_TEXT[s.id])}</div>`,
    )
    .join("\n      ");
  const calloutTweens = calloutSegs
    .map((s, i) => {
      const axis = calloutAxes[i % calloutAxes.length];
      const from = axis === "x" ? "{ opacity: 0, x: -36 }" : "{ opacity: 0, y: 30 }";
      const to =
        axis === "x"
          ? '{ opacity: 1, x: 0, duration: .5, ease: "power3.out" }'
          : '{ opacity: 1, y: 0, duration: .5, ease: "expo.out" }';
      return `      tl.fromTo("#call-${i + 1}", ${from}, ${to}, ${(s.placedStart + 0.7).toFixed(2)});`;
    })
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
        background: #f4f7fb;
        color: #142333;
        font-family: sans-serif;
      }
      .mono {
        font-family: monospace;
        font-variant-numeric: tabular-nums;
      }
      .clip {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }
      .scene {
        padding: 88px 112px;
        overflow: hidden;
        background:
          radial-gradient(860px 420px at 14% -6%, rgba(31,111,235,.18), rgba(31,111,235,0) 68%),
          radial-gradient(680px 380px at 88% 92%, rgba(31,157,87,.15), rgba(31,157,87,0) 72%),
          linear-gradient(120deg, rgba(242,184,75,.10), rgba(242,184,75,0) 42%),
          #f4f7fb;
      }
      .texture {
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(rgba(20,35,51,.055) 2px, rgba(20,35,51,0) 2px),
          linear-gradient(90deg, rgba(20,35,51,.045) 2px, rgba(20,35,51,0) 2px);
        background-size: 54px 54px;
        opacity: .72;
      }
      .ghost {
        position: absolute;
        right: -42px;
        bottom: -56px;
        font-size: 184px;
        font-weight: 900;
        color: rgba(20,35,51,.055);
        letter-spacing: 0;
      }
      .topline {
        position: absolute;
        left: 112px;
        right: 112px;
        top: 58px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: #536477;
        font-size: 24px;
        font-weight: 800;
      }
      .brand-lock {
        display: flex;
        align-items: center;
        gap: 28px;
        position: relative;
        z-index: 2;
      }
      .logo { width: 132px; height: 132px; }
      .brand-text { font-size: 76px; font-weight: 900; letter-spacing: 0; color: #142333; }
      .kicker {
        color: #1f6feb;
        font-size: 28px;
        font-weight: 900;
        margin-bottom: 24px;
        position: relative;
        z-index: 2;
      }
      .headline {
        max-width: 1160px;
        font-size: 88px;
        line-height: 1.08;
        font-weight: 900;
        letter-spacing: 0;
        position: relative;
        z-index: 2;
      }
      .subline {
        max-width: 1080px;
        margin-top: 28px;
        font-size: 38px;
        line-height: 1.42;
        color: #435365;
        font-weight: 650;
        position: relative;
        z-index: 2;
      }
      .rail {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 20px;
        margin-top: 52px;
        position: relative;
        z-index: 2;
      }
      .source-card,
      .step-card,
      .proof-panel {
        background: rgba(255,255,255,.92);
        border: 2px solid #dce7f2;
        box-shadow: 0 22px 54px rgba(20,35,51,.08);
      }
      .source-card {
        min-height: 178px;
        padding: 26px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .source-card b { display: block; font-size: 34px; color: #142333; }
      .source-card span { color: #536477; font-size: 24px; line-height: 1.38; font-weight: 650; }
      .entry-card {
        width: 860px;
        margin-top: 40px;
        padding: 34px;
        background: #fff;
        border: 3px solid #1f6feb;
        box-shadow: 0 28px 70px rgba(31,111,235,.18);
        position: relative;
        z-index: 2;
      }
      .field {
        margin-top: 20px;
        min-height: 118px;
        padding: 22px;
        border: 2px solid #dce7f2;
        background: #fbfdff;
        color: #142333;
        font-size: 27px;
        line-height: 1.45;
        font-weight: 700;
      }
      .button-pill {
        display: inline-flex;
        align-items: center;
        margin-top: 24px;
        padding: 18px 28px;
        border-radius: 999px;
        background: #1f6feb;
        color: #fff;
        font-size: 28px;
        font-weight: 900;
      }
      .step-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 20px;
        margin-top: 56px;
        position: relative;
        z-index: 2;
      }
      .step-card {
        min-height: 210px;
        padding: 28px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .step-card strong { font-size: 32px; color: #142333; }
      .step-card span { font-size: 23px; line-height: 1.4; color: #536477; font-weight: 650; }
      .demo-stage {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(760px 420px at 12% 10%, rgba(31,111,235,.22), rgba(31,111,235,0) 68%),
          radial-gradient(660px 360px at 96% 84%, rgba(31,157,87,.16), rgba(31,157,87,0) 74%),
          #101926;
      }
      .demo-video {
        position: absolute;
        left: 112px;
        top: 104px;
        width: 1696px;
        height: 806px;
        object-fit: cover;
        border: 3px solid rgba(255,255,255,.20);
        box-shadow: 0 28px 80px rgba(0,0,0,.36);
      }
      .demo-chrome {
        position: absolute;
        left: 112px;
        top: 62px;
        width: 1696px;
        height: 44px;
        background: #172335;
        border: 3px solid rgba(255,255,255,.20);
        border-bottom: 0;
        color: #c9d7e8;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 0 20px;
        font-size: 22px;
        font-weight: 800;
      }
      .dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #1f9d57;
        box-shadow: 20px 0 0 #f2b84b, 40px 0 0 #d83a3a;
        margin-right: 42px;
      }
      .callout {
        inset: auto auto 224px 132px;
        width: auto;
        height: auto;
        max-width: 690px;
        padding: 22px 30px;
        background: rgba(255,255,255,.97);
        border-left: 9px solid #1f9d57;
        color: #142333;
        font-size: 31px;
        line-height: 1.35;
        font-weight: 900;
        box-shadow: 0 22px 58px rgba(0,0,0,.24);
      }
      .proof-grid {
        display: grid;
        grid-template-columns: 1.2fr 1fr;
        gap: 36px;
        margin-top: 50px;
        position: relative;
        z-index: 2;
      }
      .proof-panel { padding: 34px; }
      .proof-panel h3 { font-size: 35px; margin-bottom: 22px; }
      .proof-line {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        padding: 15px 0;
        border-top: 2px solid #e3ebf3;
        font-size: 26px;
        font-weight: 850;
      }
      .proof-line span { color: #536477; font-weight: 750; }
      .proof-line strong { text-align: right; }
      .caption {
        /* override .clip { width:100%; inset:0 } so the pill shrinks to its text
           and centers via left:0/right:0 + margin auto (no transform — GSAP owns that). */
        left: 0;
        right: 0;
        top: auto;
        bottom: 44px;
        margin-left: auto;
        margin-right: auto;
        width: max-content;
        max-width: 1320px;
        height: auto;
        padding: 16px 42px;
        background: rgba(12,20,31,.93);
        color: #fff;
        font-size: 30px;
        line-height: 1.34;
        font-weight: 900;
        text-align: center;
        border-radius: 16px;
        box-shadow: 0 16px 50px rgba(0,0,0,.30);
      }
      .wipe {
        position: absolute;
        inset: 0;
        background: #1f6feb;
        transform: translateX(-105%);
        z-index: 50;
      }
      .accent-line {
        width: 360px;
        height: 9px;
        background: #1f6feb;
        margin-top: 34px;
        position: relative;
        z-index: 2;
      }
      .accent-line::after {
        content: "";
        position: absolute;
        right: -28px;
        top: -9px;
        width: 27px;
        height: 27px;
        border-radius: 50%;
        background: #1f9d57;
      }
      .final-mark {
        position: absolute;
        right: 114px;
        bottom: 92px;
        width: 184px;
        height: 184px;
        opacity: .96;
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${WIDTH}" data-height="${HEIGHT}">
      <!-- Audio is mixed separately (BGM + scene-aligned narration, sidechain-ducked) and muxed after render; visual render stays silent. -->

      <section id="s1" class="scene clip" data-start="0" data-duration="${s1Duration.toFixed(2)}" data-track-index="1">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>PRICE ORDER</div>
        <div class="topline"><span>CHS-IHSSC · 医药价格治理</span><span class="mono">Pitch + Demo · ${runtimeLabel}</span></div>
        <div class="brand-lock" style="margin-top: 220px;">
          <img class="logo" src="assets/logomark.svg" alt="" />
          <div>
            <div class="brand-text">价序</div>
            <div class="subline" style="margin-top: 12px;">政策变更后的存量机构执行价复核 Agent</div>
          </div>
        </div>
        <img class="final-mark" src="assets/logo-mono.svg" alt="" />
      </section>

      <section id="s2" class="scene clip" data-start="${s2Start.toFixed(2)}" data-duration="${s2Duration.toFixed(2)}" data-track-index="2">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>POLICY</div>
        <div class="kicker">一线原话</div>
        <h1 class="headline" style="font-size: 78px;">政策一变，昨天核过的价，今天就不算数。</h1>
        <div class="rail">
          <div class="source-card"><b>政策更新</b><span>集采中选价一落地，几万条存量执行价要重新对</span></div>
          <div class="source-card"><b>存量执行价</b><span>编码、包装单位、目录别名各说各话</span></div>
          <div class="source-card"><b>人工审批</b><span>规则明明清楚的项，也要一条条人工点头</span></div>
          <div class="source-card"><b>经验流失</b><span>审完的判断没人记住，下个月从零再来</span></div>
        </div>
      </section>

      <section id="s3" class="scene clip" data-start="${s3Start.toFixed(2)}" data-duration="${s3Duration.toFixed(2)}" data-track-index="3">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>WORKSPACE</div>
        <div class="kicker">第一屏</div>
        <h1 class="headline" style="font-size: 78px;">首页只有一个入口。</h1>
        <div class="entry-card">
          <div class="mono" style="font-size: 25px; color: #536477; font-weight: 800;">/workspace?prompt=drift_review_loop</div>
          <div class="field">核完并闭环处置这批机构执行价异常：对照最新政策事实检出漂移并生成复核任务；命中激活规则的自动处置；其余转人审；人审结论沉淀为规则候选。</div>
          <div class="button-pill">发给价序</div>
        </div>
      </section>

      <div id="demo-bg" class="demo-stage clip" data-start="${demoStart}" data-duration="${demoDuration}" data-track-index="4"></div>
      <div id="demo-chrome" class="demo-chrome clip" data-start="${demoStart}" data-duration="${demoDuration}" data-track-index="5">
        <span class="dot"></span>
        <span>real browser demo · /workspace + 批次闸门 · 四次真实 live-provider run · 政策同步真实抓取</span>
      </div>
      <video id="demo-video" class="demo-video clip" data-start="${demoStart}" data-duration="${demoDuration}" data-track-index="6" src="assets/demo-footage-fit.mp4" muted playsinline></video>
      ${callouts}

      <section id="s5" class="scene clip" data-start="${resultStart}" data-duration="${resultDuration}" data-track-index="7">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>OBJECTS</div>
        <div class="kicker">结果落到对象里</div>
        <h1 class="headline" style="font-size: 80px;">一批乱表，跑成六类可审批对象。</h1>
        <div class="proof-grid">
          <div class="proof-panel">
            <h3>六类业务对象</h3>
            <div class="proof-line"><span>漂移队列</span><strong>检出 → 复核 → 闭环</strong></div>
            <div class="proof-line"><span>人审任务</span><strong>批准即学习样本</strong></div>
            <div class="proof-line"><span>处置建议卡</span><strong>机构口径草稿</strong></div>
            <div class="proof-line"><span>规则候选</span><strong>dry-run 后人工激活</strong></div>
            <div class="proof-line"><span>政策事实</span><strong>版本 hash 可追溯</strong></div>
            <div class="proof-line"><span>数据修复</span><strong>映射 · patch · 归并</strong></div>
          </div>
          <div class="proof-panel">
            <h3>系统写入</h3>
            <div class="proof-line"><span>状态库</span><strong>本地 SQLite</strong></div>
            <div class="proof-line"><span>决策日志</span><strong>不可变 · 全留痕</strong></div>
            <div class="proof-line"><span>过程回放</span><strong>run_event 每步</strong></div>
            <div class="proof-line"><span>效能条</span><strong>实时 · 可对账</strong></div>
          </div>
        </div>
      </section>

      <section id="s6" class="scene clip" data-start="${mechanismStart}" data-duration="${mechanismDuration}" data-track-index="8">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>LOOP</div>
        <div class="kicker">它每次怎么跑</div>
        <h1 class="headline" style="font-size: 76px;">模型出计划，服务端管状态和红线。</h1>
        <div class="step-grid">
          <div class="step-card"><strong>读上下文</strong><span>执行价表 · 政策事实 · 决策日志</span></div>
          <div class="step-card"><strong>排计划 · 跑工具</strong><span>核价 · 归并 · 换算 · 漂移检测</span></div>
          <div class="step-card"><strong>写状态 · 转人审</strong><span>六类对象落库 · 拿不准不硬判</span></div>
          <div class="step-card"><strong>学规则 · 过护栏</strong><span>人审沉淀 → dry-run → 激活 → 自动处置</span></div>
        </div>
      </section>

      <section id="s7" class="scene clip" data-start="${closeStart}" data-duration="${closeDuration}" data-track-index="9">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>RUN IT</div>
        <div class="brand-lock" style="margin-top: 190px;">
          <img class="logo" src="assets/logomark.svg" alt="" />
          <div>
            <div class="kicker" style="margin-bottom: 12px;">评委可复跑</div>
            <h1 class="headline" style="font-size: 76px; max-width: 1200px;">一条命令复跑全链路，十七项检查全绿。</h1>
            <div class="subline">政策同步 → 漂移 → 人审 → 挖掘 → 激活 → 自动处置 · 合成/脱敏数据 · 真实模型 · auth_failed 不编假线索</div>
            <div class="accent-line"></div>
          </div>
        </div>
      </section>

      <div id="w1" class="wipe clip" data-layout-ignore data-start="${(s2Start - 0.35).toFixed(2)}" data-duration=".74" data-track-index="60"></div>
      <div id="w2" class="wipe clip" data-layout-ignore data-start="${(s3Start - 0.35).toFixed(2)}" data-duration=".74" data-track-index="61"></div>
      <div id="w3" class="wipe clip" data-layout-ignore data-start="${(demoStart - 0.35).toFixed(2)}" data-duration=".74" data-track-index="62"></div>
      <div id="w4" class="wipe clip" data-layout-ignore data-start="${(resultStart - 0.35).toFixed(2)}" data-duration=".74" data-track-index="63"></div>
      <div id="w5" class="wipe clip" data-layout-ignore data-start="${(mechanismStart - 0.35).toFixed(2)}" data-duration=".74" data-track-index="64"></div>
      <div id="w6" class="wipe clip" data-layout-ignore data-start="${(closeStart - 0.35).toFixed(2)}" data-duration=".74" data-track-index="65"></div>
      ${captionHtml}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const inUp = (sel, t, y = 46, dur = .72, ease = "power3.out") =>
        tl.fromTo(sel, { opacity: 0, y }, { opacity: 1, y: 0, duration: dur, ease }, t);
      const inLeft = (sel, t, x = -56, dur = .68, ease = "expo.out") =>
        tl.fromTo(sel, { opacity: 0, x }, { opacity: 1, x: 0, duration: dur, ease }, t);
      const inRight = (sel, t, x = 58, dur = .64, ease = "power4.out") =>
        tl.fromTo(sel, { opacity: 0, x }, { opacity: 1, x: 0, duration: dur, ease }, t);
      const inScale = (sel, t, dur = .65, ease = "back.out(1.4)") =>
        tl.fromTo(sel, { opacity: 0, scale: .92 }, { opacity: 1, scale: 1, duration: dur, ease }, t);
      function wipe(sel, t) {
        tl.fromTo(sel, { xPercent: -105 }, { xPercent: 0, duration: .34, ease: "power4.in" }, t);
        tl.to(sel, { xPercent: 105, duration: .40, ease: "power4.out" }, t + .34);
      }

      inScale("#s1 .logo", .24, .82, "expo.out");
      inLeft("#s1 .brand-text", .48, -72, .78, "power3.out");
      inUp("#s1 .subline", .82, 34, .68, "sine.out");
      inRight("#s1 .topline", .18, 32, .62, "power4.out");
      tl.fromTo("#s1 .final-mark", { opacity: 0, rotation: -10, scale: .88 }, { opacity: .96, rotation: 0, scale: 1, duration: 1.05, ease: "expo.out" }, 1.2);
      tl.to("#s1 .final-mark", { rotation: 2, scale: 1.025, duration: 5.4, yoyo: true, repeat: 1, ease: "sine.inOut" }, 2.5);

      inLeft("#s2 .kicker", ${(s2Start + 0.4).toFixed(2)}, -44, .48, "power4.out");
      inUp("#s2 .headline", ${(s2Start + 0.75).toFixed(2)}, 62, .84, "expo.out");
      tl.fromTo("#s2 .source-card", { opacity: 0, y: 48, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .66, stagger: .12, ease: "back.out(1.16)" }, ${(s2Start + 1.75).toFixed(2)});

      inLeft("#s3 .kicker", ${(s3Start + 0.35).toFixed(2)}, -44, .48, "power4.out");
      inUp("#s3 .headline", ${(s3Start + 0.7).toFixed(2)}, 52, .76, "expo.out");
      tl.fromTo("#s3 .entry-card", { opacity: 0, x: 64, scale: .985 }, { opacity: 1, x: 0, scale: 1, duration: .78, ease: "power3.out" }, ${(s3Start + 1.7).toFixed(2)});
      tl.fromTo("#s3 .button-pill", { opacity: 0, scale: .88 }, { opacity: 1, scale: 1, duration: .42, ease: "back.out(1.6)" }, ${(s3Start + 2.65).toFixed(2)});

      inScale("#demo-video", ${demoStart + 0.34}, .76, "expo.out");
      inLeft("#demo-chrome", ${demoStart + 0.24}, -80, .56, "power3.out");
${calloutTweens}

      inLeft("#s5 .kicker", ${resultStart + 0.26}, -42, .46, "power4.out");
      inUp("#s5 .headline", ${resultStart + 0.56}, 54, .78, "expo.out");
      tl.fromTo("#s5 .proof-panel", { opacity: 0, y: 44, scale: .98 }, { opacity: 1, y: 0, scale: 1, duration: .72, stagger: .16, ease: "power3.out" }, ${resultStart + 1.55});
      tl.fromTo("#s5 .proof-line", { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: .36, stagger: .045, ease: "sine.out" }, ${resultStart + 2.25});

      inLeft("#s6 .kicker", ${mechanismStart + 0.26}, -42, .46, "power4.out");
      inUp("#s6 .headline", ${mechanismStart + 0.54}, 54, .78, "expo.out");
      tl.fromTo("#s6 .step-card", { opacity: 0, y: 46, rotationX: 5 }, { opacity: 1, y: 0, rotationX: 0, duration: .72, stagger: .1, ease: "power3.out" }, ${mechanismStart + 1.55});

      inScale("#s7 .logo", ${closeStart + 0.35}, .72, "expo.out");
      inLeft("#s7 .kicker", ${closeStart + 0.58}, -48, .5, "power3.out");
      inUp("#s7 .headline", ${closeStart + 0.9}, 54, .82, "expo.out");
      inUp("#s7 .subline", ${closeStart + 1.72}, 36, .62, "sine.out");
      tl.fromTo("#s7 .accent-line", { scaleX: 0, transformOrigin: "left center" }, { scaleX: 1, duration: .7, ease: "power3.out" }, ${closeStart + 2.4});
      tl.to("#s7", { opacity: 0, duration: .8, ease: "sine.inOut" }, ${total - 0.9});

      wipe("#w1", ${(s2Start - 0.35).toFixed(2)});
      wipe("#w2", ${(s3Start - 0.35).toFixed(2)});
      wipe("#w3", ${demoStart - 0.35});
      wipe("#w4", ${resultStart - 0.35});
      wipe("#w5", ${mechanismStart - 0.35});
      wipe("#w6", ${closeStart - 0.35});
${captionTweens}

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
        name: "jiaxu-pitch-demo",
        private: true,
        type: "module",
        scripts: {
          check: `npx --yes hyperframes@${HF_VERSION} lint && npx --yes hyperframes@${HF_VERSION} validate && npx --yes hyperframes@${HF_VERSION} inspect`,
          render: `npx --yes hyperframes@${HF_VERSION} render --output ../pitch-demo-2.mp4 --fps 30 --quality high`,
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
        id: "jiaxu-pitch-demo-v22",
        name: "价序 Pitch + Demo (V2.2)",
        createdAt: new Date().toISOString(),
        duration: total,
        runtimeMode: "narration-driven",
        baseUrl: BASE,
        ttsProvider: TTS_PROVIDER,
        ttsVoice: TTS_VOICE,
        ttsRate: TTS_RATE,
        rawDemoDuration: rawDuration,
        narrationDuration: narrationSegments.reduce((acc, s) => acc + s.duration, 0),
        narrationSegments: narrationSegments.map((s) => ({ id: s.id, start: s.start, duration: Number(s.duration.toFixed(2)) })),
        narrationCharacters: narration.length,
        demoStart,
        demoDuration,
        demoBeats,
        demoRetime: plan.map((p) => ({
          seg: p.seg,
          beat: p.id,
          kind: p.kind,
          raw_s: Number(p.raw.toFixed(2)),
          target_s: Number(p.target.toFixed(2)),
          speed_x: Number((1 / p.factor).toFixed(2)),
        })),
        demoTargets: targets,
        resultStart,
        mechanismStart,
        closeStart,
        hyperframesVersion: HF_VERSION,
      },
      null,
      2,
    ),
    "utf8",
  );
  return {
    total,
    demoDuration,
    retimePlan: plan,
    rawDuration,
    narrationSegments,
    audioFinal,
    s2Start,
    s3Start,
    demoStart,
    resultStart,
    mechanismStart,
    closeStart,
  };
}

// Inspect samples must dodge the six 0.74s wipe transitions: the wipe panel
// intentionally covers the incoming scene, and a sample inside that window
// reports the covered text as an occlusion error. Sampling fixed mid-scene
// fractions keeps the full layout audit active on every real frame.
function inspectSampleTimes(meta) {
  const scenes = [
    [0, meta.s2Start],
    [meta.s2Start, meta.s3Start],
    [meta.s3Start, meta.demoStart],
    [meta.resultStart, meta.mechanismStart],
    [meta.mechanismStart, meta.closeStart],
    [meta.closeStart, meta.total - 1],
  ];
  const times = [];
  for (const [a, b] of scenes) {
    const span = b - a;
    times.push(a + span * 0.35, a + span * 0.75);
  }
  const demoSpan = meta.resultStart - meta.demoStart;
  for (const f of [0.08, 0.28, 0.48, 0.68, 0.88]) {
    times.push(meta.demoStart + demoSpan * f);
  }
  return times.sort((x, y) => x - y).map((t) => t.toFixed(2)).join(",");
}

function renderVideo(meta) {
  const rendered = join(OUT, "pitch-demo-2-rendered.mp4");
  const final = join(OUT, "pitch-demo-2.mp4");
  const legacy = join(OUT, "demo.mp4");
  const reuseRender = process.env.REUSE_RENDER === "1" && existsSync(rendered);

  if (reuseRender) {
    console.log(`[video] REUSE_RENDER=1 → skipping HyperFrames render, reusing ${relative(ROOT, rendered)}`);
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
    run("npx", [...HF, "render", PROJECT, "--output", rendered, "--fps", "30", "--quality", "high"]);
  }

  // Visual render is silent; mux the separately-built final audio (BGM + narration) onto the video stream.
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    rendered,
    "-i",
    meta.audioFinal,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-b:v",
    "5000k",
    "-minrate",
    "5000k",
    "-maxrate",
    "5000k",
    "-bufsize",
    "10000k",
    "-x264-params",
    "nal-hrd=cbr:force-cfr=1",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-shortest",
    final,
  ]);
  copyFileSync(final, legacy);
  return final;
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

  const silence = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", videoPath, "-af", "silencedetect=noise=-42dB:d=1.0", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  writeFileSync(join(QA, "silencedetect.log"), `${silence.stdout || ""}${silence.stderr || ""}`, "utf8");

  const contactStep = Math.max(1, Math.floor((meta.total * 30) / 10));
  const contactSelect = Array.from({ length: 10 }, (_, i) => `eq(n\\,${i * contactStep})`).join("+");
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    "-vf",
    `select='${contactSelect}',scale=360:-1,tile=5x2,setpts=N/FRAME_RATE/TB`,
    "-frames:v",
    "1",
    join(QA, "contact-sheet.jpg"),
  ]);

  const videoStream = probe.streams.find((s) => s.codec_name === "h264") ?? probe.streams[0];
  const size = Number(probe.format.size || 0);
  const dur = Number(probe.format.duration || 0);
  const bitrateMbps = dur > 0 ? (size * 8) / dur / 1_000_000 : 0;
  const speeds = meta.retimePlan.map((p) => 1 / p.factor);
  const summary = {
    video: relative(ROOT, videoPath),
    legacy_video: "docs/video/demo.mp4",
    width: videoStream.width,
    height: videoStream.height,
    fps: videoStream.avg_frame_rate,
    codec: videoStream.codec_name,
    duration_s: Number(dur.toFixed(2)),
    target_duration_s: Number(meta.total.toFixed(2)),
    max_duration_s: TARGET_DURATION,
    estimated_bitrate_mbps: Number(bitrateMbps.toFixed(2)),
    has_aac_audio: probe.streams.some((s) => s.codec_name === "aac"),
    raw_demo_duration_s: Number(meta.rawDuration.toFixed(2)),
    narration_duration_s: Number(meta.narrationSegments.reduce((acc, s) => acc + s.duration, 0).toFixed(2)),
    narration_segments: meta.narrationSegments.map((s) => ({
      id: s.id,
      anchor_s: s.start,
      placed_start_s: Number((s.placedStart ?? s.start).toFixed(2)),
      duration_s: Number(s.duration.toFixed(2)),
    })),
    narration_coverage_pct: Number(
      ((meta.narrationSegments.reduce((acc, s) => acc + s.duration, 0) / meta.total) * 100).toFixed(1),
    ),
    background_music: {
      source: "hackathonhunter/assets/music",
      intro_outro: BGM_INTRO,
      mid: BGM_MID,
      mix: "crossfade bed, sidechain-ducked under narration (ratio 12), bed ~-26dB / narration window ~-17dB",
    },
    composed_duration_s: meta.total,
    runtime_mode: "narration-driven (scenes cut on narration end, total < 5min)",
    demo_retime: {
      mode: "per-beat (provider waits compressed, clicks near 1x)",
      beats: meta.retimePlan.map((p) => ({
        seg: p.seg,
        beat: p.id,
        kind: p.kind,
        raw_s: Number(p.raw.toFixed(2)),
        target_s: Number(p.target.toFixed(2)),
        speed_x: Number((1 / p.factor).toFixed(2)),
      })),
      speed_min_x: Number(Math.min(...speeds).toFixed(2)),
      speed_max_x: Number(Math.max(...speeds).toFixed(2)),
    },
    tts_provider: TTS_PROVIDER,
    tts_voice: TTS_VOICE,
    hyperframes_project: relative(ROOT, PROJECT),
    contact_sheet: relative(ROOT, join(QA, "contact-sheet.jpg")),
    real_browser_path: `${BASE}/ → /workspace（政策变更→漂移→人审→规则激活→自动处置）→ /release/REL-2026-0623-07/result（差比价+64号红黄分档）`,
    demo_start_s: meta.demoStart,
    result_start_s: Number(meta.resultStart.toFixed(2)),
    mechanism_start_s: Number(meta.mechanismStart.toFixed(2)),
    close_start_s: Number(meta.closeStart.toFixed(2)),
  };
  writeFileSync(join(QA, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log("[video] QA summary", summary);
}

async function main() {
  const reusableFootage = join(OUT, "_reuse-demo-footage.mp4");
  const reusableBeats = join(OUT, "_reuse-demo-beats.json");
  const existingFootage = join(ASSETS, "demo-footage.mp4");
  const existingBeats = join(ASSETS, "demo-beats.json");
  if (REUSE_DEMO_FOOTAGE && existsSync(existingFootage) && existsSync(existingBeats)) {
    copyFileSync(existingFootage, reusableFootage);
    copyFileSync(existingBeats, reusableBeats);
  }
  clean();
  copyBrand();
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
  qaVideo(videoPath, meta);
  rmSync(WORK, { recursive: true, force: true });
  console.log("[video] done ->", videoPath);
}

main().catch((e) => {
  console.error("[video] error:", e);
  process.exit(1);
});
