# 深度研究任务：医保价格治理工作台「政策实时同步 + Agent 自动审批 + 公开数据爬取」重构

你是医保信息化 + 数据治理 + AI Agent 架构方向的资深专家。请做一次带引用来源的 **深度研究（Deep Research）**，最终产出一份可直接交给工程团队执行的**详细重构方案**。请尽量引用真实、可核查的中国医保领域来源（国家医保局、省级医保局、省级药品（耗材）集中采购平台 / 阳光采购平台、国家/省医保服务平台、医保信息业务编码标准等）。

## 一、产品背景（真实代码库，请据此给出可落地方案）

产品名「价序」：一个**对话式医药价格治理工作台**，服务对象是医保局价格招采处 / 价格监测岗 / 数据治理岗 / 集采落地专班。技术栈：Next.js 15 (App Router) + React 19 + TypeScript，数据层用 SQLite（node:sqlite），已用 OpenNext 部署到 Cloudflare Workers（Workers 上回退到内存库）。LLM 走 OpenAI 兼容 /chat/completions。

核心业务流（现状）：
1. 一个「价格批次」(dataset_release) 含多行价格记录 (dataset_row：item_code 医保项目编码 / item_name / price_date / procurement_channel 采购渠道 / region 地区 / unit_price 单价)。
2. 「放行闸门 Agent」(runReleaseGateAgent)：observe 观察 → plan（**调用 LLM 仅做规划**，产出 issue_focus / ordered_tools / rationale / expected_state）→ tools（对**每一行**跑确定性校验器）→ 写入 row_issue / correction_proposal（纠错）/ quarantine_item（异常处置）/ release_approval（待人工核验）→ verify → replay 回放时间线。
3. 治理状态词：待治理 / 监测中 / 纠错候选 / 异常处置 / 可落地 / 需核验 / 检查失败。整批按优先级聚合。

**关键现状问题（正是本次要解决的）：**
- **规则是硬编码的**：校验逻辑 `classifyRow()` 与 5 个校验器（schema_mapper / price_catalog_standardizer / reference_price_monitor / collective_landing_tracker / anomaly_profiler）写死在 `tools.ts`，阈值写死（参考价涨幅 >15% 需核验、集采价 >中选价 3% 容忍、超最高有效价异常处置等）。
- **政策/参考数据是静态 fixtures**：价格目录 `PRICE_CATALOG`（每项有 referencePrice/ceilingPrice/collectivePrice/landedRegions）、别名 `CODE_ALIASES`、采购渠道 `PROCUREMENT_CHANNELS` 全部写死在 `fixtures.ts`，仅有版本号常量（如 `RELEASE_RULE_VERSION`、`CODE_DICTIONARY_VERSION`、`ACCESS_POLICY_VERSION`）。**没有任何外部政策接入或更新机制。**
- **审批 100% 人工**：`decideApproval(id, approved/rejected, approver, notes)` 只更新一行 release_approval（含 policy_snapshot / approver / human_notes / decided_at）。**没有预置规则引擎、没有学习闭环、没有自动审批。**

## 二、真实痛点（来自一线医保人员反馈，必须解决）

1. **医保政策实时更新**：政策（医保目录、集采中选结果、最高有效价/挂网价规则、支付标准、价格联动规则等）频繁变化，**已入库或新报送的数据经常跟最新政策对不上**，人工很难实时跟住。
2. **规则审批负担重**：希望能**预置规则**，并且**根据历史「人 + Agent」交互记录，让 Agent 自动完成审批**（高置信、可解释、可回溯），把人从重复审批中解放出来，只看真正需要人判断的少数。
3. **希望实时爬取**最新医保政策类网站、阳光医保 / 省级集采平台等的**公开数据**来驱动上述能力。

## 三、请深度研究并回答（带引用）

### A. 真实公开数据源盘点与接入可行性
- 系统梳理可获取医保价格/政策数据的**真实公开来源**：国家医保局（nhsa.gov.cn）政策发布、国家医保服务平台、国家组织药品/耗材集采中选结果、**省级阳光采购/药械集中采购平台**（举例若干省，如上海阳光医药采购网、广东药交中心、浙江/江苏等）、医保信息业务编码标准数据库（药品/医用耗材编码）。
- 对每类来源说明：是否有**开放 API / 数据下载 / 仅网页公告**、更新频率、数据格式（HTML/Excel/PDF/JSON）、字段、稳定性。
- **合规与可爬性**：robots、使用条款、爬取频率与反爬、个人信息与敏感数据规避、引用与留痕要求。给出「可直接对接 / 需人工下载导入 / 不建议爬」的分级建议。

### B. 政策即代码（Policy-as-Code）与规则引擎
- 监管/合规领域**声明式规则引擎**与**规则版本化**最佳实践（如规则包版本、生效日期 effective_date、可回溯快照、影响面评估、灰度）。
- 适合本场景（TS / 边缘运行时 / 体量不大）的规则表达方式与可选开源方案对比（如 JSON-Logic、CEL、json-rules-engine、轻量自研 DSL 等），给出推荐与理由。
- 如何把现有硬编码校验器与阈值迁移成**数据驱动、可由业务人员编辑、带版本与生效时间**的规则。

### C. 政策—数据漂移检测（核心：数据跟政策对不上）
- 当政策/目录/集采结果更新后，如何对**存量批次与新报送数据**做**重校（re-evaluation）与漂移检测**：发现「曾经合规、现因政策变更而不合规」或「编码/中选价/落地区域已变更」的记录。
- 设计漂移信号、严重度、通知与重新进入治理流程的闭环。

### D. 人在回路 → Agent 自动审批的学习闭环（重点）
- 如何从**历史人工审批决策**（release_approval 的 approve/reject + notes + policy_snapshot + 上下文特征）**挖掘可复用的审批规则**：特征工程、规则归纳/挖掘、置信度与支持度（support/confidence）、冲突检测。
- **安全护栏**：何种情形可自动放行、何种必须人工；自动审批的置信阈值、影响面上限、按金额/严重度/品类分级、双人复核、可一键撤销/回滚、全程审计与回放。
- **预置规则 + 学习规则**如何共存与优先级；新规则上线前的「人工批准激活（ratify）」与灰度。
- 给出可执行的学习/挖掘算法选型（从简单的频繁模式/决策列表/可解释模型，到 LLM 辅助规则草拟 + 确定性执行的混合架构），并说明为什么在医保高风险场景**不能让 LLM 直接拍板**、而应「LLM 草拟 / 确定性引擎执行 / 人工批准」。

### E. 针对本代码库的详细重构方案（最重要，要具体到工程）
请给出：
1. **数据模型变更**：新增/调整哪些表（如 policy_source、policy_snapshot、rule_pack、rule、rule_version、ingestion_run、policy_change、drift_finding、approval_decision_log、learned_rule、auto_approval_audit 等），字段与关系。
2. **模块/目录设计**：在现有 `src/lib`（agent/ provider/ repo/ tools/ fixtures/ types）基础上，新增的爬取/接入层、规则引擎层、漂移检测层、自动审批层应如何组织；Cloudflare Workers 上爬取/定时如何做（Cron Triggers、Queues、抓取与解析在哪一层）。
3. **API 与 Agent 改造**：放行闸门 Agent 如何从「硬编码校验」改为「加载当前生效 rule_pack + 政策快照执行」；自动审批引擎的接口；爬取/同步任务的接口与触发。
4. **安全边界与合规**：保留「合成/脱敏 vs 真实数据」标注、provider 降级不可伪造结论、人工复核边界等现有原则，并扩展到自动审批与外部数据接入。
5. **分阶段落地路线图**（MVP → 进阶），每阶段的范围、风险、验收标准；明确哪些可在黑客松/演示期内完成、哪些是生产化方向。
6. **风险与反模式**：政策误读、过度自动化、爬取合规、规则冲突、数据漂移漏检等，及对应缓解。

## 四、输出格式
- 用中文输出，结构化分节（对应 A–E），关键结论给出**引用链接**。
- E 部分给出尽量具体的表结构（可用伪 SQL / TS 类型）、模块清单、接口签名草案、路线图表格。
- 末尾给一页「**给工程团队的执行清单（按优先级排序的 TODO）**」。
