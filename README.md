# 医保可信数据通行 Agent

弄脏一行医保数据，看 Agent 决定这批数据能否通行。

这是一个面向医保数据中心 / 可信数据空间运营人员的发布通行工作台。运营人员在数据进入分析、共享、建模或报表取数之前，选中或改坏一行脱敏医保数据，点一下 `通行检查`。Agent 观察数据、规则和访问策略，调用一组确定性工具，然后把这批 release 写到下一个更安全的状态。

它不是数据质量大屏，也不是规则命中报告。核心是一个会改状态的 Agent：每次运行都会落库 `row_issue`、`correction_proposal` / `quarantine_item` / `release_approval`、`agent_run` 和 `replay_timeline`，并更新 release 状态。

## 60 秒演示

1. 打开 `/release/REL-2026-0623-07`。
2. 选一行数据，点一个变更类型：错误编码、未来日期、身份冲突、权限拒绝。右栏会先给一个后果预览。
3. 点 `通行检查`。
4. release 状态从 `待发布` 变成 `纠错候选`、`隔离` 或 `需审批`。
5. 翻到 `运行回放`，看 Agent 的计划、7 次工具调用的输入输出、状态写入和 before/after。

四个变更走出三种不同终态：

| 变更 | 触发的工具判定 | 终态 |
|---|---|---|
| 错误编码（I1O） | 字典未命中但有高置信别名 I1O→I10 | 纠错候选 |
| 未来日期 | 服务日期晚于发布日 | 隔离 |
| 身份冲突 | token 前缀撞号、模糊匹配 | 需审批 |
| 权限拒绝 | 角色/用途越出访问策略 | 需审批 |

## Agent 怎么工作

一次运行按 observe → plan → tools → mutate → verify → recover 走：

1. Observe：读 release 元数据、选中行、schema、医保目录字典版本、访问策略、身份注册表、发布规则。
2. Plan：调 live LLM（OpenAI 兼容接口）生成计划，决定先查哪条规则、预计落到哪个状态。计划在关键路径上，provider 挂了这一步就走降级。
3. Tools：服务端按计划顺序跑确定性校验器（schema、目录字典、tokenized 身份、访问策略、日期异常），每个工具返回结构化判定，不靠 LLM 自由文本下结论。
4. Mutate：按安全优先级（隔离 > 审批 > 纠错 > 可发布）选终态，落库 issue 和对应的纠错/隔离/审批对象，更新 release 状态。
5. Verify：重新读 release 状态，确认写入生效，记录 before/after。
6. Recover：provider 不可用、字典缺失、身份模糊、策略冲突时不自动放行。provider 故障落 `检查失败`，敏感场景停到 `需审批` / `隔离`。

LLM 负责规划，工具负责裁决和写库。这条分工是产品的安全边界。

## 本地运行

需要 Node 22 及以上（用到内置的 `node:sqlite`，无需编译原生模块）。

### 1. 配置 provider 凭证

Agent 的计划步骤要调真实的 OpenAI 兼容接口。凭证发现脚本会按顺序检查 `.env.local`、`.dev.vars`、`.env`、`$HOME/user_key.txt`、`$HOME/use_key.txt`，把找到的 key 写进 `.env.local`：

```bash
npm run creds
```

需要三个变量：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`。key 只在服务端使用，不会下发到浏览器。

### 2. 安装、构建、启动

```bash
npm install
npm run build
npm run start    # http://localhost:3000
```

或开发模式：`npm run dev`。

首次访问会自动播种合成数据。要手动重置：

```bash
npm run seed
```

### 3. 跑验证

两个必需的 live smoke，断言不同输入产生不同计划、工具、审批边界、状态和输出哈希：

```bash
npm run smoke:agent
```

桌面加移动截图，通过真实点击驱动 live agent：

```bash
npm run shots
```

## 状态机

| 状态 | 含义 | 谁来处理 |
|---|---|---|
| 待发布 | 还没跑通行检查 | 运营员 |
| 检查中 | Agent 正在 observe/plan/tool/write | 等结果 |
| 纠错候选 | 有高置信纠错建议 | 目录维护员审纠错提案 |
| 隔离 | 这行不该继续通行 | 看 quarantine 原因 |
| 可发布 | 符合规则和策略 | 发布或导出审计 |
| 需审批 | Agent 不自动定 | 业务审批人处理 |
| 检查失败 | provider/规则源/存储故障 | 恢复后重试 |

## 数据与隐私

仓库里的医保数据全是合成脱敏 fixtures（见 `src/lib/fixtures.ts`），身份用掩码 token（如 `330203******9012`），界面标注 `合成脱敏数据`。没有任何真实敏感医保数据。fixtures 保持和真实可信数据空间一致的行结构、源清单和策略快照，方便后续替换成真实适配器。

## 技术栈

- Next.js 15（App Router）+ React 19。
- Radix Themes + 自定义 CSS，受控产品风格。
- `node:sqlite` 落库，schema 见 `src/lib/db.ts`，9 张表。
- 服务端 Agent：`src/lib/agent/runReleaseGateAgent.ts`，工具 `src/lib/agent/tools.ts`，provider 客户端 `src/lib/provider.ts`。

## 目录速览

```
src/app/release/[id]        通行检查工作台（hero）
src/app/release/[id]/result 结果状态
src/app/release/[id]/replay 运行回放
src/app/release/[id]/proof  源清单与策略
src/app/release/[id]/approval 发布审批
src/app/queue               release/隔离/审批队列
src/app/settings            provider/规则/角色
src/app/api/agent/release-gate  运行 Agent 的接口
src/lib/                    agent、provider、db、repo、fixtures
scripts/                    凭证发现、播种、smoke、截图
docs/screenshots/           桌面与移动截图
```

## 运行证据

都在 `docs/evidence/`：

- live provider 调用：`docs/evidence/live-provider-smoke.json`（含 token 计量和真实延迟）
- 两次 agent run：`docs/evidence/agent-runs.json`
- 四变更状态矩阵：`docs/evidence/g4-traceability.json`
- 降级路径：`docs/evidence/degraded-run.json`
- 声明对照表：`docs/evidence/claim-matrix.json`
- 运行检查：`docs/evidence/operations-check.json`
- 截图：`docs/screenshots/`
