# 价序重构方案：政策实时同步 + 规则引擎 + Agent 自动审批 + 公开数据接入

> 状态：**代码库实证版（基于当前源码）**。A 节「真实数据源」与 B–E 的最佳实践校验将由 GPT Pro 深度研究结果合并补充（session `jiaxu-policy`，产物 `docs/research/policy-autoapproval-report.md`）。

## 0. 一线痛点 → 现状根因 → 改造目标

| 一线痛点（医保老师反馈） | 现状根因（源码实证） | 改造目标 |
|---|---|---|
| 医保政策实时更新，**数据常跟政策对不上** | 价格目录/别名/渠道/阈值全部硬编码在 `src/lib/fixtures.ts` + `src/lib/agent/tools.ts`；`RELEASE_RULE_VERSION` 等版本号是装饰性常量，无外部接入、无重校机制 | 政策数据**版本化入库 + 外部接入 + 漂移重校** |
| 审批负担重，希望**预置规则 + Agent 按历史自动审批** | `classifyRow()` 规则写死；`decideApproval()` 仅人工更新一行，无规则引擎、无学习、无自动审批 | **声明式规则引擎 + 人在回路学习 + 受护栏的自动审批** |
| 希望**实时爬取**政策/阳光采购公开数据 | 无任何采集层，全部为合成 fixtures | **采集管线（爬取/下载/导入）+ 留痕 + 合规分级** |

## 1. 现状架构（实证）

- **放行闸门 Agent** `src/lib/agent/runReleaseGateAgent.ts`：observe → plan（`generateAgentPlan` 调 LLM **仅做规划**）→ tools（对每行跑 `classifyRow`）→ 写 `row_issue / correction_proposal / quarantine_item / release_approval` → verify → `replay_timeline`。**状态结论由确定性 `classifyRow` 决定，LLM 不拍板**（这是要保留的安全原则）。
- **确定性校验器** `src/lib/agent/tools.ts`：`schema_mapper / price_catalog_standardizer / reference_price_monitor / collective_landing_tracker / anomaly_profiler` + `classifyRow()` 优先级裁决。阈值硬编码：参考价涨幅 `>15%` 需核验、集采 `>3%` 容忍、超 `ceilingPrice` 异常处置等。
- **政策/参考数据** `src/lib/fixtures.ts`：`PRICE_CATALOG`（`referencePrice/ceilingPrice/collectivePrice/landedRegions`）、`CODE_ALIASES`、`PROCUREMENT_CHANNELS`、版本常量。
- **数据层** `src/lib/db.ts`：Node 用 `node:sqlite`，Cloudflare Workers 回退内存库（`"ASSETS" in globalThis` 判定）；`getDb()` 返回 `DatabaseLike`。表：`dataset_release / dataset_row / source_manifest / access_rule_snapshot / row_issue / correction_proposal / quarantine_item / release_approval / agent_run / replay_timeline` + 晨会子系统 `morning_session / daily_lead / watchlist`。
- **审批** `src/lib/repo.ts::decideApproval()`：`UPDATE release_approval SET status, approver, human_notes, decided_at`。`release_approval` 已含 `policy_snapshot / approver / human_notes / decided_at` —— **这是自动审批学习的现成原料**。
- **LLM** `src/lib/provider.ts`：OpenAI 兼容 `/chat/completions`，`response_format=json_object`，45s 超时，凭证 `src/lib/env.ts` 从 `.env.local/.dev.vars/...` 发现；provider 不可用即**降级、不伪造结论**（保留原则）。

## 2. 目标架构总览

```
采集层 ingestion ──► 政策快照 policy_snapshot（版本化、带生效日）
                          │
                          ├─► 规则引擎 rules.engine（加载生效 rule_pack + 快照）
                          │        ▲ 预置规则(preset) + 学习规则(learned, 经人工批准)
                          │
放行闸门 Agent ──evaluate──┘──► row_issue/correction/quarantine/approval
                          │
                          ├─► 自动审批 approval.autoApprove（护栏 + 审计 + 可回滚）
                          │        ▲ approval_decision_log → learn → learned_rule → ratify
                          │
新快照生效 ──► 漂移检测 drift（重校存量批次）──► drift_finding ──► 回到治理流
```

## 3. 数据模型变更（伪 SQL / TS 草案）

### 3.1 政策接入与快照
```sql
-- 注册的外部来源
CREATE TABLE policy_source (
  id TEXT PRIMARY KEY, name TEXT, kind TEXT,           -- catalog|collective_result|rule_doc|code_dict
  url TEXT, fetch_mode TEXT,                            -- api|download|html|manual
  schedule TEXT, enabled INTEGER, last_fetched_at TEXT,
  provenance TEXT, is_synthetic INTEGER DEFAULT 1
);
-- 一次采集/导入尝试（可回放、可审计）
CREATE TABLE ingestion_run (
  id TEXT PRIMARY KEY, source_id TEXT, started_at TEXT, finished_at TEXT,
  status TEXT, fetched_bytes INTEGER, parsed_records INTEGER,
  diff_summary_json TEXT, error_category TEXT, raw_ref TEXT  -- R2 对象键（生产）
);
-- 不可变政策快照（版本化、带生效日）
CREATE TABLE policy_snapshot (
  id TEXT PRIMARY KEY, source_id TEXT, version_label TEXT,
  effective_date TEXT, captured_at TEXT, checksum TEXT,
  status TEXT,                                          -- draft|active|superseded
  is_synthetic INTEGER DEFAULT 1
);
-- 规范化政策数据（替代 fixtures 的硬编码）
CREATE TABLE catalog_item (
  id TEXT PRIMARY KEY, snapshot_id TEXT, item_code TEXT, name TEXT,
  category TEXT, unit TEXT, reference_price REAL, ceiling_price REAL,
  collective_price REAL, landed_regions_json TEXT, effective_date TEXT
);
CREATE TABLE code_alias (snapshot_id TEXT, alias_code TEXT, canonical_code TEXT, confidence REAL);
CREATE TABLE procurement_channel (snapshot_id TEXT, channel TEXT, note TEXT);
```

### 3.2 规则引擎
```sql
CREATE TABLE rule_pack (
  id TEXT PRIMARY KEY, name TEXT, version TEXT, effective_date TEXT,
  status TEXT,                                          -- draft|active|superseded
  created_by TEXT, ratified_by TEXT, notes TEXT, created_at TEXT
);
CREATE TABLE rule (
  id TEXT PRIMARY KEY, pack_id TEXT, key TEXT,
  kind TEXT,                                            -- validation|auto_approval|routing
  when_json TEXT,                                       -- 条件 DSL（JSON-Logic/CEL）
  then_json TEXT,                                       -- 动作：state/severity/writer/auto_decision/params
  priority INTEGER, source TEXT,                        -- preset|learned
  confidence REAL, support_count INTEGER, enabled INTEGER, explanation TEXT
);
```
- 把 `classifyRow` 的优先级分支与阈值迁移为 `rule` 行（`when` 命中条件，`then` 给状态/严重度/writer）。阈值（15%/3%）变成规则参数。**执行仍确定性**：`engine.evaluate(row, ctx)` 按 `priority` 命中首条 → verdict。

### 3.3 自动审批 + 学习闭环
```sql
-- 每个人工决策的特征化日志（学习原料）
CREATE TABLE approval_decision_log (
  id TEXT PRIMARY KEY, approval_id TEXT, run_id TEXT, release_id TEXT,
  issue_type TEXT, severity TEXT, item_category TEXT, region TEXT,
  channel TEXT, delta_pct_bucket TEXT, source_rule TEXT, policy_version TEXT,
  decision TEXT, approver TEXT, notes TEXT, decided_at TEXT
);
-- 从历史挖掘出的候选规则（未生效）
CREATE TABLE learned_rule (
  id TEXT PRIMARY KEY, condition_json TEXT, decision TEXT,
  support INTEGER, confidence REAL, conflicts_json TEXT,
  status TEXT,                                          -- proposed|ratified|rejected
  drafted_by TEXT, ratified_by TEXT, created_at TEXT
);
-- 每次自动放行的审计（可回滚）
CREATE TABLE auto_approval_audit (
  id TEXT PRIMARY KEY, approval_id TEXT, rule_id TEXT, confidence REAL,
  inputs_json TEXT, decision TEXT, reversible INTEGER DEFAULT 1,
  reverted_at TEXT, created_at TEXT
);
```

### 3.4 漂移
```sql
CREATE TABLE policy_change (id TEXT PRIMARY KEY, from_snapshot TEXT, to_snapshot TEXT, change_type TEXT, item_code TEXT, before_json TEXT, after_json TEXT, created_at TEXT);
CREATE TABLE drift_finding (id TEXT PRIMARY KEY, release_id TEXT, row_id TEXT, change_id TEXT, kind TEXT, severity TEXT, detail TEXT, status TEXT, created_at TEXT);
```

## 4. 模块/目录设计（在现有 `src/lib` 上扩展）

```
src/lib/
  policy/
    sources.ts          # 来源注册表 + Connector 接口
    connectors/         # nhsa.ts, sunshine-<prov>.ts, collective-result.ts, code-dict.ts
    snapshot.ts         # 读写快照、按 effective_date 解析「当前生效」
    drift.ts            # 快照 diff → policy_change → 重校存量 → drift_finding
  rules/
    dsl.ts              # when/then 条件与动作 schema（JSON-Logic/CEL 封装）
    engine.ts           # 加载生效 rule_pack + 快照；evaluate(row, ctx) -> RowVerdict
    presets.ts          # 现 5 校验器/classifyRow 迁移成的预置规则
  approval/
    decisionLog.ts      # 捕获人工决策 + 特征抽取
    learn.ts            # 频繁模式/决策列表挖掘 learned_rule（可 LLM 辅助草拟）
    autoApprove.ts      # 受护栏执行 + auto_approval_audit + 回滚
  ingestion/
    run.ts              # ingestion_run 编排（Cron/Queue 入口）
```
- **Cloudflare 生产化**：现状 Workers 用内存库，不可持久。采集/规则/审批要落地需 **D1**（替代 SQLite）+ **R2**（原始抓取留档）+ **Cron Triggers**（定时同步）+ **Queues**（异步抓取解析）。抓取 HTML 用 `fetch`（必要时 Browser Rendering）。`wrangler.jsonc` 增加 `triggers.crons / [[d1_databases]] / [[r2_buckets]] / [[queues]]` 与 `scheduled()` 入口。

## 5. API 与 Agent 改造

- `runReleaseGateAgent`：把 `classifyRow(row, releaseDate)` 替换为 `rules.engine.evaluate(row, { snapshot, rulePack, releaseDate })`；写入 approval 后调用 `approval.autoApprove(newApprovals)`，命中护栏的自动决策、其余留 pending；写 `auto_approval_audit` 并补 replay 事件（保持可回放）。
- 新增 API：
  - `POST /api/policy/ingest`（触发来源抓取）、`GET /api/policy/snapshots`、`POST /api/policy/snapshots/:id/activate`
  - `GET/POST /api/rules`（rule_pack 编辑/批准激活）
  - `POST /api/approval/auto`、`GET /api/approval/audit`、`POST /api/approval/revert`
  - `GET /api/drift`（漂移清单）、`POST /api/learn`（触发挖掘）、`POST /api/learned-rules/:id/ratify`

## 6. 安全边界与合规（扩展现有原则）

- **LLM 不拍板**：状态结论与自动审批均由确定性引擎执行；LLM 仅做规划/规则草拟/解释。
- **自动审批护栏**：仅当 `confidence ≥ 阈值 && support ≥ N && severity ≤ medium && 影响金额 ≤ 上限 && 无规则冲突 && 品类在白名单` 才自动放行；超阈值/高额/异常处置一律人工；学习规则必须 **人工批准激活 (ratify)** + 灰度；全程审计 + 一键回滚。
- **数据合规**：保留「合成/脱敏 vs 真实」标注（`is_synthetic`）；尊重来源 robots/条款、限频、留痕；不可爬来源走人工导入回退；provider/来源不可用即失败不伪造。

## 7. 分阶段路线图

| 阶段 | 范围 | 验收 |
|---|---|---|
| **P0（演示期可做，纯 SQLite/内存）** | fixtures → 种子化 `policy_snapshot`；规则引擎执行现校验器（rule_pack）；导入 1 份真实阳光采购数据（手工）；新快照触发漂移重校；从种子历史学习 **1 条安全规则**并演示自动审批 + 审计 + 回滚 | 现 9/9 冒烟仍过；放行结论与改造前一致；漂移/自动审批/回滚可在 UI 演示 |
| **P1（接入真实源）** | 1–2 个省级阳光平台可下载 Excel/公告 + 国家集采结果连接器；Workers 上 Cron+Queue+D1+R2；漂移通知 | 定时同步成功落 D1；存量批次重校产出 drift |
| **P2（学习产线化）** | 挖掘 job + ratify UI + 护栏分级 + 多源 + 监控 | 学习规则经批准上线；自动审批占比与误判率可观测 |

## 8. 风险与反模式

政策误读（→ 人工批准 + 生效日 + 快照留痕）；过度自动化（→ 护栏分级 + 可回滚 + 占比监控）；爬取合规（→ 分级 + 限频 + 人工导入回退）；规则冲突（→ 冲突检测 + 优先级 + 灰度）；漂移漏检（→ 新快照强制重校 + 校验覆盖率）；Workers 内存不持久（→ 生产用 D1/R2）。

## 9. 给工程团队的执行清单（按优先级）

1. 抽 `fixtures.ts` 政策数据 → `policy_snapshot + catalog_item/code_alias/procurement_channel`（种子）。
2. 建 `rules/engine.ts + dsl.ts + presets.ts`，把 `classifyRow` 迁成 rule_pack；`runReleaseGateAgent` 改调引擎（行为对齐回归）。
3. 建 `policy/snapshot.ts` 的「当前生效」解析 + `drift.ts` 重校；UI 出 `/drift`。
4. 建 `approval/decisionLog.ts + learn.ts + autoApprove.ts` + 护栏 + `auto_approval_audit` + 回滚；UI 出审计与撤销。
5. 建 `ingestion/`：先做手工导入连接器，跑通 1 份真实数据；再上 Cron/Queue/D1/R2。
6. 合并 GPT Pro 深度研究的真实数据源清单与合规分级，落 `policy_source` 注册表。
```
