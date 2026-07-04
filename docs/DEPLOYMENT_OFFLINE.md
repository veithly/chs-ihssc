# 价序 · 医保内网离线部署清单

> 目标环境：大赛提供的医保内网虚拟机（8C16G，云桌面，与互联网隔离，「只进不出」）。
> 内网大模型：私有化部署千问 Qwen 235B，OpenAI 兼容 `/chat/completions` 接口，统一 token 鉴权（接口文档与 token 由主办方下发）。
> 结论先行：价序全栈无外网依赖——Next.js 产物 + SQLite 单文件 + 预置政策公告，唯一的外部调用就是 LLM API，把 `OPENAI_BASE_URL` 指到内网千问即可。

---

## 1. 外网机器上打包（进场前完成）

内网机器不能 `npm install`，所有依赖必须随包带入。在外网开发机执行：

```bash
# 1) 干净构建
npm ci
npm run build

# 2) 打全量包（源码 + node_modules + .next 产物 + 样例数据）
cd ..
tar -czf jiaxu-offline.tar.gz \
  --exclude='chs-ihssc/.git' \
  --exclude='chs-ihssc/data/*.db*' \
  --exclude='chs-ihssc/docs/video' \
  chs-ihssc

# 3) 准备与内网 VM 匹配的 Node 运行时（Node >= 22，按 VM 架构选）
#    x64:  https://nodejs.org/dist/v22.x/node-v22.x-linux-x64.tar.xz
#    arm64: node-v22.x-linux-arm64.tar.xz
#    Windows 云桌面: node-v22.x-win-x64.zip
```

U 盘内容清单（过安检用）：

| 文件 | 说明 |
|------|------|
| `jiaxu-offline.tar.gz` | 项目全量包（含 node_modules，无 .git） |
| `node-v22.x-<os>-<arch>.tar.xz` | Node 运行时，免安装解压即用 |
| `docs/deck/jiaxu-deck.pdf` | 展示 deck（备份，摊位可打印） |
| `settlement-sample.csv` | 演示上传用样例（项目内 `public/samples/` 也有一份） |

注意：`better-sqlite3` 含原生二进制，**打包机与内网 VM 的 OS/架构必须一致**（如内网是 Linux x64，就在 Linux x64 容器里 `npm ci && npm run build` 后打包；Mac 上打的包在 Linux 上跑不起来）。不确定架构时带两份包。

---

## 2. 内网机器上部署（10 分钟）

```bash
# 1) 解压 Node 运行时并入 PATH
tar -xf node-v22.x-linux-x64.tar.xz -C ~/runtime
export PATH=~/runtime/node-v22.x-linux-x64/bin:$PATH
node --version   # 应为 v22+

# 2) 解压项目
tar -xzf jiaxu-offline.tar.gz && cd chs-ihssc

# 3) 配置内网千问（写 .env.local，不进代码仓库）
cat > .env.local <<'EOF'
OPENAI_API_KEY=<主办方下发的统一token>
OPENAI_BASE_URL=<内网千问API地址，如 http://10.x.x.x:8000/v1>
OPENAI_MODEL=<接口文档给的模型名，如 qwen-235b>
EOF

# 4) 启动（已随包带入构建产物，无需再 build）
npx next start -p 3000
```

配置发现顺序（`src/lib/env.ts`）：`process.env` → 项目 `.env.local` / `.dev.vars` / `.env` → `$HOME/user_key.txt` → `$HOME/use_key.txt`。云桌面上最省事的就是第 3 步的 `.env.local`。

若内网端口受限，`-p` 换成允许的端口即可，无其他端口依赖。

---

## 3. 部署后验证（5 分钟跑通关键路径）

按顺序执行，全部通过即可开演：

| # | 动作 | 预期 |
|---|------|------|
| 1 | `curl -X POST localhost:3000/api/admin/reseed` | `ok:true`，5 个批次 156 行 |
| 2 | 打开 `/`，看 landing 实时统计 | 数字非零，无报错 |
| 3 | `/release/REL-2026-0623-07` 点「启动扫描」 | 状态到「异常处置」，结果页出现差比价折算超限 + 红/黄预警徽标 |
| 4 | `/workspace` 上传 `public/samples/settlement-sample.csv`，指令「核完并闭环处置这批机构执行价异常」 | 生成字段映射/归并组/流程任务，YP-AXL-005 出差比价核验任务 |
| 5 | 「政策事实」tab 点 `政策变更演示 640→560` 后重跑 | 漂移队列检出存量执行价漂移 |
| 6 | 打开任一任务的「处置结果单」 | 报告页 200 渲染 |

命令行等价物（不方便点 UI 时）：

```bash
npm run smoke:agent                                  # 15/15
DEMO_URL=http://127.0.0.1:3000 npm run verify:v2     # 17/17（政策同步一步走离线预置公告）
```

---

## 4. 内网兼容性风险与已内置的对策

这些坑在外网开发时已经踩过并写进代码，部署时不需要动，但演示被追问时要说得出来：

| 风险 | 表现 | 已内置对策 | 代码位置 |
|------|------|-----------|---------|
| 内网千问不支持 `response_format: json_object` | 计划生成报 4xx | 自动去掉该参数重试一次（兼容层） | `src/lib/provider.ts` `chatCompletionsCompat` |
| 235B 模型响应慢 | 单次调用超 90 秒 | 90s 超时 → 写降级 run（`provider_timeout`），状态置「检查失败」，不假成功；重跑即恢复 | `src/lib/provider.ts`、`runReleaseGateAgent.ts` recover 段 |
| 内网无法访问国家医保局公告页 | 政策同步抓取失败 | 预置 3 条离线公告（`ART-OFFLINE-001/002/003`，含 38 号函 560 元中选价、国办发〔2026〕9号），人审确认 → policy_fact 演进这条主线完全离线可演 | `src/lib/seed.ts` |
| token 失效 / API 地址错 | `auth_failed` | 失败态诚实展示，草稿标 `draft_unavailable`；确定性工具结果（映射/归并/换算）仍然可见 | `src/lib/provider.ts` 分类错误 |
| VM 无 GPU、无外网 npm | — | 运行时只需 Node + SQLite 单文件（`data/*.db` 首次启动自动建），无任何在线依赖 | `src/lib/db.ts` |

---

## 5. 演示前快照与恢复

```bash
# 演示前打快照（数据库是单文件，直接拷贝）
mkdir -p ~/snapshot && cp data/*.db ~/snapshot/

# 演示中途想回到干净状态：二选一
curl -X POST localhost:3000/api/admin/reseed   # 重新生成全部演示数据
cp ~/snapshot/*.db data/ && 重启进程            # 或回滚到快照
```

游园会两小时会反复演示，建议每轮开始前 reseed 一次，保证「政策变更 → 漂移 → 人审 → 规则激活 → 自动处置」的剧本从头可复现。
