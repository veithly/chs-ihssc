#!/usr/bin/env node
// 打一个可以拷进医保内网 Windows 机器直接运行的完整离线包：
//
//   dist-offline/jiaxu-win64/
//   ├── start.bat            双击启动（默认 3000 端口，可传参改）
//   ├── verify.bat           部署后验证（smoke 15 项 + verify 17 项）
//   ├── reseed.bat           重置演示数据
//   ├── README-内网部署.md    完整部署说明（同 docs/DEPLOYMENT_WINDOWS.md）
//   ├── .env.local.example   内网千问配置模板
//   ├── node/                Node.js win-x64 运行时（免安装，node:sqlite 内建）
//   ├── app/                 Next standalone 产物（自带精简 node_modules，纯 JS）
//   │   ├── server.js        入口（server.js 内部 chdir 到 app/，.env.local/data 都在 app/ 下）
//   │   ├── .next/static     静态资源
//   │   ├── public/          样例 CSV、品牌资源
//   │   ├── data/            空目录，首次启动自动建库+种子数据
//   │   └── scripts/         smoke-agent / verify-v2 / seed_demo（验证用）
//   └── materials/           摊位材料（deck PDF、演示手册）
//
// 用法：node scripts/package_offline_win.mjs [--skip-build] [--skip-node-download]
// 产物：dist-offline/jiaxu-win64-offline.zip（含 sha256）

import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, "dist-offline");
const PKG = join(DIST, "jiaxu-win64");
const NODE_VERSION = "v24.18.0"; // LTS Krypton；node:sqlite 免 flag 内建
const NODE_ZIP_NAME = `node-${NODE_VERSION}-win-x64.zip`;
const NODE_ZIP_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP_NAME}`;
const NODE_ZIP_CACHE = join(DIST, NODE_ZIP_NAME);

const args = new Set(process.argv.slice(2));
const log = (m) => console.log(`[package] ${m}`);

function sh(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

// ---------- 1. 构建 ----------
if (!args.has("--skip-build")) {
  log("OFFLINE_BUILD=1 next build (standalone) ...");
  sh("npm run build", { env: { ...process.env, OFFLINE_BUILD: "1" } });
}
const STANDALONE = join(ROOT, ".next", "standalone");
if (!existsSync(join(STANDALONE, "server.js"))) {
  console.error("[package] .next/standalone/server.js 不存在——请先 OFFLINE_BUILD=1 npm run build");
  process.exit(1);
}

// ---------- 2. 下载 Node win-x64 运行时（有缓存则跳过） ----------
mkdirSync(DIST, { recursive: true });
if (!existsSync(NODE_ZIP_CACHE) && !args.has("--skip-node-download")) {
  log(`下载 ${NODE_ZIP_URL} ...`);
  const res = await fetch(NODE_ZIP_URL);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(NODE_ZIP_CACHE));
  log(`已下载 ${(statSync(NODE_ZIP_CACHE).size / 1048576).toFixed(1)} MB`);
} else {
  log(`Node 运行时已缓存: ${NODE_ZIP_CACHE}`);
}

// ---------- 3. 组装目录 ----------
log("组装 dist-offline/jiaxu-win64 ...");
rmSync(PKG, { recursive: true, force: true });
mkdirSync(PKG, { recursive: true });

// 3.1 app/ ← standalone（剔除 dev 数据库与 mac 原生二进制）
const APP = join(PKG, "app");
cpSync(STANDALONE, APP, {
  recursive: true,
  filter: (src) => {
    if (src.includes(`${join("standalone", "data")}`) && /\.db(-wal|-shm)?$/.test(src)) return false;
    // sharp（darwin 原生二进制）仅 next/image 优化用，项目未用 next/image，Windows 上是死重
    if (src.includes(join("node_modules", "@img"))) return false;
    if (/node_modules\/sharp(\/|$)/.test(src)) return false;
    if (/^\.env(\.|$)/.test(src.split("/").pop() ?? "")) return false; // 任何 env 文件都不进包
    return true;
  },
});
mkdirSync(join(APP, "data"), { recursive: true });
writeFileSync(join(APP, "data", ".gitkeep"), "");

// 3.2 静态资源 + public（standalone 默认不含这两者）
cpSync(join(ROOT, ".next", "static"), join(APP, ".next", "static"), { recursive: true });
cpSync(join(ROOT, "public"), join(APP, "public"), { recursive: true });

// 3.3 验证脚本（自包含，仅用 node 内建模块）
mkdirSync(join(APP, "scripts"), { recursive: true });
for (const f of ["smoke-agent.mjs", "verify-v2.mjs", "seed_demo.mjs"]) {
  cpSync(join(ROOT, "scripts", f), join(APP, "scripts", f));
}

// 3.4 node/ 运行时
log("解压 Node 运行时 ...");
sh(`unzip -q "${NODE_ZIP_CACHE}" -d "${PKG}"`);
sh(`mv "${join(PKG, `node-${NODE_VERSION}-win-x64`)}" "${join(PKG, "node")}"`);

// 3.5 摊位材料
const MATERIALS = join(PKG, "materials");
mkdirSync(MATERIALS, { recursive: true });
for (const [src, dst] of [
  [join(ROOT, "docs", "deck", "jiaxu-deck.pdf"), join(MATERIALS, "jiaxu-deck.pdf")],
  [join(ROOT, "docs", "DEMO_PLAYBOOK.md"), join(MATERIALS, "DEMO_PLAYBOOK.md")],
]) {
  if (existsSync(src)) cpSync(src, dst);
}

// ---------- 4. 启动/运维脚本 ----------
// 注意：server.js 内部会 process.chdir 到 app/，因此 .env.local 与 data/ 都以 app/ 为根。
const startBat = `@echo off\r
chcp 65001 >nul\r
setlocal\r
cd /d "%~dp0"\r
set "PORT=%~1"\r
if "%PORT%"=="" set "PORT=3000"\r
set "HOSTNAME=0.0.0.0"\r
set "NODE_ENV=production"\r
if not exist "app\\.env.local" (\r
  echo [!] 未找到 app\\.env.local —— 大模型调用将不可用（页面仍可打开）。\r
  echo     请复制 .env.local.example 为 app\\.env.local 并填入内网千问地址与 token。\r
  echo.\r
)\r
echo [价序] 启动中... 端口 %PORT%（Ctrl+C 停止）\r
echo [价序] 启动后访问 http://localhost:%PORT%\r
"%~dp0node\\node.exe" "%~dp0app\\server.js"\r
endlocal\r
`;
writeFileSync(join(PKG, "start.bat"), startBat);

const verifyBat = `@echo off\r
chcp 65001 >nul\r
setlocal\r
cd /d "%~dp0"\r
set "BASE=%~1"\r
if "%BASE%"=="" set "BASE=http://127.0.0.1:3000"\r
echo [verify] 目标 %BASE%（请先运行 start.bat）\r
set "DEMO_URL=%BASE%"\r
"%~dp0node\\node.exe" "%~dp0app\\scripts\\smoke-agent.mjs"\r
if errorlevel 1 echo [verify] smoke 未全部通过，检查 app\\.env.local 与模型连通性。\r
"%~dp0node\\node.exe" "%~dp0app\\scripts\\verify-v2.mjs"\r
if errorlevel 1 echo [verify] verify-v2 未全部通过，见上方输出。\r
endlocal\r
pause\r
`;
writeFileSync(join(PKG, "verify.bat"), verifyBat);

const reseedBat = `@echo off\r
chcp 65001 >nul\r
setlocal\r
set "BASE=%~1"\r
if "%BASE%"=="" set "BASE=http://127.0.0.1:3000"\r
"%~dp0node\\node.exe" -e "fetch(process.argv[1]+'/api/admin/reseed',{method:'POST'}).then(r=>r.json()).then(d=>console.log('[reseed]',JSON.stringify(d.summary??d))).catch(e=>{console.error('[reseed] 失败：服务未启动？',e.message);process.exit(1)})" "%BASE%"\r
endlocal\r
pause\r
`;
writeFileSync(join(PKG, "reseed.bat"), reseedBat);

writeFileSync(
  join(PKG, ".env.local.example"),
  `# 复制本文件为 app/.env.local（注意在 app/ 目录里），填入主办方下发的内网千问信息\r
OPENAI_API_KEY=主办方下发的统一token\r
OPENAI_BASE_URL=http://内网千问地址:端口/v1\r
OPENAI_MODEL=接口文档给的模型名，如 qwen3-235b\r
`,
);

// README 由 docs/DEPLOYMENT_WINDOWS.md 同步（打包时复制，保持单一来源）
const winDoc = join(ROOT, "docs", "DEPLOYMENT_WINDOWS.md");
if (existsSync(winDoc)) {
  cpSync(winDoc, join(PKG, "README-内网部署.md"));
} else {
  log("警告：docs/DEPLOYMENT_WINDOWS.md 不存在，包内缺 README");
}

// ---------- 5. 压缩 + 校验 ----------
log("压缩 zip ...");
const ZIP = join(DIST, "jiaxu-win64-offline.zip");
rmSync(ZIP, { force: true });
sh(`cd "${DIST}" && zip -qry jiaxu-win64-offline.zip jiaxu-win64`);

const buf = readFileSync(ZIP);
const sha = createHash("sha256").update(buf).digest("hex");
writeFileSync(`${ZIP}.sha256`, `${sha}  jiaxu-win64-offline.zip\n`);

log(`完成：${ZIP}`);
log(`大小：${(buf.length / 1048576).toFixed(1)} MB`);
log(`sha256：${sha}`);
