# 价序

价序给医保医药价格治理岗用。打开 `/` landing，点一个业务 prompt，深链进 `/workspace`；把对不齐的价格表交给它，再用一句话说要做什么——它跑完 observe→plan→tools→mutate→verify(+drift/learn)，把能处置的项写成可审批对象，全部落 SQLite。

V2.2 针对一线反馈补了三件事：**政策跟不住**（政策事实版本化 + 公告同步人审确认 + 每次 run 对照 baseline 检出漂移）、**审批负担重**（人审结论沉淀为规则候选，dry-run 影响面预览后人审激活，下批命中的非敏感项自动处置）、**全程可审计**（自动 + 人审决策全部写不可变决策日志）。

## Try it

- Demo entry: `/`（landing，有实时工作台统计 + 业务 prompt rail）
- First action: 点 hero prompt `核完并闭环处置这批机构执行价异常`
- Workspace: `/workspace?prompt=drift_review_loop&text=...`
- Inspection: 右侧业务对象面板（漂移队列 / 人审任务 / 处置建议卡 / 规则候选 / 政策事实 / 数据修复）+ 对话区工具轨迹回放 + 审计日志条

## What it does

- Input: 合成/脱敏的价格表（CSV 上传或演示数据源）+ 一句话业务指令（内置 prompt 或自由输入）。
- Action: agent 先读字段、归并同品、换算单位、按规则评估；再对照 `policy_fact` baseline 检出政策漂移；命中已激活学习规则且护栏通过的自动处置，其余转人审（needs_user），不硬写。
- Result: 写入可审批对象——`field_mapping`、`repair_patch`、`match_group`、`workflow_task`、`institution_draft`，漂移落 `policy_drift_log`，自动/人审决策落不可变 `approval_decision_log`，过程落 `run_event`，全部进 SQLite。
- Learn: 人审批准时记录 final_action；`rule_candidate` 从决策日志按 (issue_type, severity, final_action) 挖掘（support/confidence 门槛 + 来源决策 id 可审计），dry-run 预览影响面，人审激活后下批复用；敏感项（高危/超最高有效价/集采超容忍/编码失效）被护栏永久留在人审。
- Inspection: 每个对象单独点开、单独审批；follow-up 指令会重排并更新任务/草稿；工具轨迹 observe→plan→tools→mutate→verify(+drift/learn) 每步留回放。

## Demo loop

1. 打开 `/`，看实时工作台统计；点 hero prompt 进 `/workspace`，演示数据源自动 attach，agent 当场跑。
2. 右侧「政策事实」tab 点 `政策变更演示 640→560`（或 `政策同步` 抓国家医保局公告 → 人审确认），重跑 hero prompt。
3. 「漂移队列」检出存量执行价漂移，高危漂移自动生成「政策漂移复核」人审任务。
4. 「人审任务」里批准同类项并选处置动作（final_action）；「规则候选」点挖掘 → dry-run 看影响面 → 人审激活。
5. 再跑一次：命中激活规则且护栏通过的项显示「自动处置」，敏感项仍留人审；审计日志条能看到 needs_human / human_approved / auto_approved 全留痕。
6. 拿不准的项出现 needs_user 追问；回一句 follow-up（如"把重点机构排前面"），任务/草稿重排；对话区看工具轨迹回放。

## Pitch materials

- Deck: `docs/deck/jiaxu-deck.pdf`、`docs/deck/jiaxu-deck.pptx`、`docs/deck/index.html`
- Pitch+Demo video: `docs/video/pitch-demo-2.mp4`（1920×1080 / 30fps / 255.77s ≈ 4:16）
- Video QA: `docs/video/pitch-demo/qa/summary.json`

## How it works

- Workspace agent loop: `src/lib/agent/runWorkspaceAgent.ts`
- Deterministic price tools: `src/lib/agent/workspaceTools.ts`
- 政策同步（公告抓取 → artifact 人审确认 → policy_fact）: `src/lib/policy/fetcher.ts`
- 政策漂移检测（baseline 现读 policy_fact）: `src/lib/workspace/drift.ts`
- 自动审批护栏（敏感项一律人审）: `src/lib/workspace/guardrails.ts`
- 学习规则引擎（挖掘/dry-run/激活/复用 + 决策日志）: `src/lib/workspace/rules.ts`、`src/lib/workspace/taskDecision.ts`
- Live provider (OpenAI 兼容，国产 step): `src/lib/provider.ts`
- SQLite schema + persistence: `src/lib/db.ts`
- Workspace repo + CSV: `src/lib/workspace/repo.ts`、`src/lib/workspace/csv.ts`
- Landing snapshot (实时统计): `src/lib/workspace/landingSnapshot.ts`
- Workspace APIs: `src/app/api/workspace/*`
- Main UI: `src/app/page.tsx`（landing）、`src/app/workspace/page.tsx`、`src/components/LandingClient.tsx`、`src/components/WorkspaceClient.tsx`

价序只写处置建议、修复 patch、归并组、流程任务和机构口径草稿等工作状态。发函、通报、违规认定和关闭线索必须由业务人员确认。模型负责出计划，状态和人审边界由服务端管。

## Limits

- 演示数据是合成/脱敏数据，见 `src/lib/fixtures.ts`。
- 当前没有接入真实省级招采平台、HIS、医院系统或生产工单。
- Provider 不可用时，确定性对象仍可见，草稿标 `draft_unavailable`，不把本地规则包装成 AI 成功。

## Run locally

需要 Node 22 及以上。

```bash
npm install
npm run creds        # 从 $HOME/user_key.txt / use_key.txt 注入 OPENAI_API_KEY 等
npm run build
npm run start
```

本地默认地址：`http://localhost:3000/`

验证：

```bash
npm run smoke:agent    # 15/15
DEMO_URL=http://127.0.0.1:3000 npm run verify:v2   # 17/17，V2 政策同步→漂移→人审→挖掘→激活→自动处置全链路
npm run shots          # docs/screenshots/01-08, 10-13（09 见 scripts/screenshot-failure.mjs）
```

最近一次 G4 验证：

- `npm run build` 通过。
- `npm run smoke:agent` 通过，15/15。
- `npm run verify:v2` 通过，17/17（`.hunter/v2-verification.json`）：政策同步真实抓取国家医保局公告页 fetched=20；政策变更后检出 6 条漂移并建 6 个复核任务；4 条同模式人审沉淀出规则候选（support=4 · confidence=1.0）；dry-run 影响面 4 命中 0 护栏拦截；激活后下批 run 自动处置 2 条；决策日志含 needs_human / human_approved / ratify_rule / auto_approved 全留痕。
- 一次 demo run：18 行 → 8 字段映射 · 5 修复 · 7 同品归并 · 17 流程任务 · 2 机构草稿（`.hunter/agent-runs.json`）。
- 失败态：`OPENAI_API_KEY=bad-key` 返回 `auth_failed`，草稿 `draft_unavailable`，截图 `docs/screenshots/09-workspace-provider-failure.png`。
