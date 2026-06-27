#!/usr/bin/env node
// Build the canonical HackathonHunter G5 Pitch + Demo video for 价序.
//
// Pipeline:
// 1) record real 1080p browser footage from / (landing) → /workspace
// 2) generate zh-CN narration from docs/video/pitch-demo-narration.txt
// 3) write a HyperFrames composition with a 5min pitch-demo arc
// 4) lint, validate, inspect, render, then run ffmpeg media QA
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
const BASE = process.env.DEMO_URL?.replace(/\/$/, "") || "http://127.0.0.1:3300";
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

// Captions are derived 1:1 from the narration segments (see writeProjectFiles), so
// each subtitle is locked to the voice line it paraphrases — no hand-tuned timestamps.
const CAPTION_TEXT = {
  s1: "把表格交给它，说清楚今天要办成什么",
  s2: "价格岗的早上，是一堆对不齐的表",
  s3: "第一屏不是大屏，是一个对话框",
  demo1: "真实产品在跑：读字段、归并、换算、按规则评估",
  demo2: "一份交代：18 行 · 8 映射 · 3 预填 · 3 异常",
  demo3: "价高离谱先疑数据，不直接判违规",
  demo4: "缺包装单位已预填，问我要不要转数据治理",
  demo5: "改一句话，右侧草稿和流程任务跟着重排",
  s5: "5 类已生成对象，逐项可审批、可回放",
  s6a: "工具轨迹 observe→plan→tools→mutate→verify 留回放",
  s6b: "模型只给计划，状态和人审边界服务端管",
  s7: "评委从首页点 prompt，进 workspace 复跑",
};
// Short on-footage pointers during the demo (one per demo narration segment).
const CALLOUT_TEXT = {
  demo1: "真实产品 · /workspace",
  demo2: "一份交代，不是一句“已完成”",
  demo3: "先疑数据，不急着定性",
  demo4: "缺字段 → 转人工确认",
  demo5: "改输入 → 整条链路重算",
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

async function resetSamples() {
  const res = await fetch(`${BASE}/api/admin/reseed`, { method: "POST" }).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`Could not reset sample data at ${BASE}/api/admin/reseed`);
  }
}

async function recordProductFootage() {
  await resetSamples();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: WORK, size: { width: WIDTH, height: HEIGHT } },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  const vid = page.video();
  const wait = (ms) => page.waitForTimeout(ms);

  async function softScroll(amount, repeats = 1) {
    for (let i = 0; i < repeats; i += 1) {
      await page.mouse.wheel(0, amount);
      await wait(420);
    }
  }

  // 1) Landing page — show hero, telemetry, prompts
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-landing-hero]");
  await wait(2800);
  await softScroll(700, 1);
  await wait(1800);
  await softScroll(-700, 1);
  await wait(1200);

  // 2) Click the first prompt — deep-link to /workspace and auto-run
  const repairPrompt =
    "请核完并修复这批价格数据。能确定的字段和单位先修复；拿不准的问我；可以处置的生成机构核实口径和流程任务。";
  const promptUrl = `${BASE}/workspace?prompt=repair_price_batch&text=${encodeURIComponent(repairPrompt)}`;
  await page.goto(promptUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-conversation-composer]", { timeout: 30000 });
  // Wait for auto-run to complete (agent returns messages + objects)
  await page.waitForFunction(() => {
    const counts = Array.from(document.querySelectorAll("[data-generated-object] .object-tab-count"));
    return counts.some((c) => Number((c.textContent ?? "").trim()) > 0);
  }, { timeout: 120000 }).catch(() => {});
  await wait(6200);
  await softScroll(520, 2);
  await wait(2200);
  await softScroll(-360, 1);
  await wait(1600);

  // 3) Send a follow-up instruction — change tasks (recover → data governance)
  const followUp = "把重点机构放前面，并把缺包装单位的项先转数据治理确认。";
  const composer = page.locator("[data-conversation-composer] textarea");
  await composer.fill(followUp);
  // Radix TextArea needs a real input event to flip React state and enable the send button.
  await composer.dispatchEvent("input");
  await wait(1200);
  const sendBtn = page.locator("[data-conversation-composer] button:has-text('发给价序')");
  await sendBtn.waitFor({ state: "visible" });
  // Wait until the button is actually enabled (auto-run finished, composer non-empty).
  await page.waitForFunction(() => {
    const btn = document.querySelector("[data-conversation-composer] button");
    return btn && !btn.disabled;
  }, { timeout: 120000 }).catch(() => {});
  await sendBtn.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(8400);
  await softScroll(640, 2);
  await wait(3200);

  // 4) Walk through the generated objects panel
  await page.waitForSelector("[data-generated-object]", { timeout: 60000 }).catch(() => {});
  await softScroll(-900, 2);
  await wait(2000);
  await softScroll(420, 2);
  await wait(2400);

  // 5) Visit settings for proof breadth (conversation-first shape: only /workspace and /settings exist)
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await wait(3000);
  await softScroll(420, 1);
  await wait(2000);

  // 6) End on landing again
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await wait(3000);

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
  return raw;
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

function writeProjectFiles({ demoVideo, narrationSegments, narration }) {
  const rawDuration = duration(demoVideo);

  // --- Narration-driven timeline -------------------------------------------
  // Every non-demo scene is sized to its own narration: a short lead-in, the
  // speech itself, then a small tail before it cuts straight to the next scene.
  // Nothing is padded to reach a fixed 5:00 — the total floats to whatever the
  // narration needs and stays under five minutes. The demo block is sized to its
  // narration and the real footage is time-stretched to fill it, so the picture
  // and the voice describing it stay locked together.
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
  const demoDuration = LEAD + sum("demo1", "demo2", "demo3", "demo4", "demo5") + 4 * SCENE_GAP + TAIL;

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
    demo4: demoStart + LEAD, demo5: demoStart + LEAD,
    s5: resultStart + LEAD, s6a: mechanismStart + LEAD, s6b: mechanismStart + LEAD,
    s7: closeStart + LEAD,
  };
  for (const seg of narrationSegments) {
    if (anchors[seg.id] != null) seg.start = anchors[seg.id];
  }

  // Time-stretch the real browser footage to exactly fill the demo block so the
  // tour and the demo narration stay in step (screen-cast slowdown reads fine).
  const demoFootage = join(ASSETS, "demo-footage-fit.mp4");
  const stretch = demoDuration / rawDuration;
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", demoVideo,
    "-filter_complex", `[0:v]setpts=${stretch.toFixed(5)}*PTS,fps=30,format=yuv420p[v]`,
    "-map", "[v]", "-an",
    "-t", demoDuration.toFixed(2),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    // Dense keyframes: HyperFrames seeks per-frame; sparse GOPs freeze the picture.
    "-g", "30", "-keyint_min", "30", "-sc_threshold", "0", "-movflags", "+faststart",
    demoFootage,
  ]);
  console.log(`[video] demo footage stretched ${rawDuration.toFixed(1)}s -> ${demoDuration.toFixed(1)}s (x${stretch.toFixed(2)})`);

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
        width: 760px;
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
      .step-card strong { font-size: 34px; color: #142333; }
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
        grid-template-columns: 1fr 1fr;
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
        padding: 18px 0;
        border-top: 2px solid #e3ebf3;
        font-size: 27px;
        font-weight: 850;
      }
      .proof-line span { color: #536477; font-weight: 750; }
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
            <div class="subline" style="margin-top: 12px;">把表格交给它，直接说你要完成的价格治理工作</div>
          </div>
        </div>
        <img class="final-mark" src="assets/logo-mono.svg" alt="" />
      </section>

      <section id="s2" class="scene clip" data-start="${s2Start.toFixed(2)}" data-duration="${s2Duration.toFixed(2)}" data-track-index="2">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>09:00</div>
        <div class="kicker">早上九点</div>
        <h1 class="headline">桌上是一堆对不齐的表。</h1>
        <div class="rail">
          <div class="source-card"><b>挂网价</b><span>省平台更新，名称和编码口径未必一致</span></div>
          <div class="source-card"><b>执行价</b><span>机构回传，包装单位和票据要对齐</span></div>
          <div class="source-card"><b>集采进度</b><span>中选价落地慢，容易卡住回访</span></div>
          <div class="source-card"><b>昨日未完</b><span>催过的回函今天还要继续追</span></div>
        </div>
      </section>

      <section id="s3" class="scene clip" data-start="${s3Start.toFixed(2)}" data-duration="${s3Duration.toFixed(2)}" data-track-index="3">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>WORKSPACE</div>
        <div class="kicker">第一屏</div>
        <h1 class="headline" style="font-size: 78px;">把表格交给它，再用一句话说要做什么。</h1>
        <div class="entry-card">
          <div class="mono" style="font-size: 25px; color: #536477; font-weight: 800;">/workspace</div>
          <div class="field">核完并修复这批价格数据。能修的先修，拿不准的问我，可处置的生成机构核实口径和流程任务。</div>
          <div class="button-pill">发给价序</div>
        </div>
      </section>

      <div id="demo-bg" class="demo-stage clip" data-start="${demoStart}" data-duration="${demoDuration}" data-track-index="4"></div>
      <div id="demo-chrome" class="demo-chrome clip" data-start="${demoStart}" data-duration="${demoDuration}" data-track-index="5">
        <span class="dot"></span>
        <span>real browser demo · ${escapeHtml(BASE)}/workspace</span>
      </div>
      <video id="demo-video" class="demo-video clip" data-start="${demoStart}" data-duration="${demoDuration}" data-track-index="6" src="assets/demo-footage-fit.mp4" muted playsinline></video>
      ${callouts}

      <section id="s5" class="scene clip" data-start="${resultStart}" data-duration="${resultDuration}" data-track-index="7">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>OBJECTS</div>
        <div class="kicker">结果落到对象里</div>
        <h1 class="headline" style="font-size: 80px;">18 行表，变成 5 类可审批对象。</h1>
        <div class="proof-grid">
          <div class="proof-panel">
            <h3>已生成对象</h3>
            <div class="proof-line"><span>字段映射</span><strong>8</strong></div>
            <div class="proof-line"><span>修复 patch</span><strong>3</strong></div>
            <div class="proof-line"><span>同品归并</span><strong>6</strong></div>
          </div>
          <div class="proof-panel">
            <h3>系统写入</h3>
            <div class="proof-line"><span>流程任务</span><strong>4</strong></div>
            <div class="proof-line"><span>机构草稿</span><strong>4</strong></div>
            <div class="proof-line"><span>回放</span><strong>run_event · observe→verify</strong></div>
          </div>
        </div>
      </section>

      <section id="s6" class="scene clip" data-start="${mechanismStart}" data-duration="${mechanismDuration}" data-track-index="8">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>LOOP</div>
        <div class="kicker">它每次怎么跑</div>
        <h1 class="headline" style="font-size: 76px;">模型给计划，服务端管状态和人审边界。</h1>
        <div class="step-grid">
          <div class="step-card"><strong>读上下文</strong><span>CSV / 演示数据源 / 回函 / 未完</span></div>
          <div class="step-card"><strong>排计划</strong><span>核价 / 标化 / 修复 / 催办 / 流程</span></div>
          <div class="step-card"><strong>跑工具</strong><span>映射 · 归并 · 换算 · 规则 · 草稿</span></div>
          <div class="step-card"><strong>写状态 + 追问</strong><span>落库 SQLite · 拿不准转人审</span></div>
        </div>
      </section>

      <section id="s7" class="scene clip" data-start="${closeStart}" data-duration="${closeDuration}" data-track-index="9">
        <div class="texture" data-layout-ignore></div>
        <div class="ghost" data-layout-ignore>RUN IT</div>
        <div class="brand-lock" style="margin-top: 190px;">
          <img class="logo" src="assets/logomark.svg" alt="" />
          <div>
            <div class="kicker" style="margin-bottom: 12px;">评委可复跑</div>
            <h1 class="headline" style="font-size: 78px; max-width: 1160px;">从首页点一个 prompt 进 /workspace，看 18 行表怎么变成可审批对象。</h1>
            <div class="subline">合成/脱敏来源 · 真实模型 provider · SQLite 状态 · auth_failed 不生成假线索</div>
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
        id: "jiaxu-pitch-demo-2",
        name: "价序 Pitch + Demo",
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
  return { total, demoDuration, demoStretch: stretch, rawDuration, narrationSegments, audioFinal, demoStart, resultStart, mechanismStart, closeStart };
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

    const inspect = spawnSync("npx", [...HF, "inspect", PROJECT, "--samples", "14", "--json"], {
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
      mix: "crossfade bed, sidechain-ducked under narration (ratio 12), bed ~-26dB / narration window ~-16dB",
    },
    composed_duration_s: meta.total,
    runtime_mode: "narration-driven (scenes cut on narration end, total < 5min)",
    demo_stretch_x: meta.demoStretch ? Number(meta.demoStretch.toFixed(2)) : undefined,
    tts_provider: TTS_PROVIDER,
    tts_voice: TTS_VOICE,
    hyperframes_project: relative(ROOT, PROJECT),
    contact_sheet: relative(ROOT, join(QA, "contact-sheet.jpg")),
    real_browser_path: `${BASE}/ → /workspace`,
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
  const existingFootage = join(PROJECT, "assets", "demo-footage.mp4");
  if (REUSE_DEMO_FOOTAGE && existsSync(existingFootage)) {
    copyFileSync(existingFootage, reusableFootage);
  }
  clean();
  copyBrand();
  const demoVideo = existsSync(reusableFootage)
    ? (() => {
        const target = join(ASSETS, "demo-footage.mp4");
        copyFileSync(reusableFootage, target);
        rmSync(reusableFootage, { force: true });
        return target;
      })()
    : await recordProductFootage();
  const { segments: narrationSegments, narration } = await generateAudio();
  const meta = writeProjectFiles({ demoVideo, narrationSegments, narration });
  const videoPath = renderVideo(meta);
  qaVideo(videoPath, meta);
  rmSync(WORK, { recursive: true, force: true });
  console.log("[video] done ->", videoPath);
}

main().catch((e) => {
  console.error("[video] error:", e);
  process.exit(1);
});
