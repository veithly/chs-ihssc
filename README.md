# 价序

价序给医保价格治理岗用。早上打开 `/morning`，点 `开晨会`，它把昨夜新增和昨日未完的价格线索排成今天该核、该催、该回访的处置顺序，并留下来源、排序理由、待办和回放。

## Try it

- Demo path: `/morning`
- First action: `开晨会`
- Inspection path: `/morning/[sessionId]` -> `/leads/[leadId]`

## What it does

- Input: 合成/脱敏的价格批次、集采落地信号、重点对象、昨日未回访任务和用户优先级输入。
- Action: 价序调用 live provider 规划今日线索优先级，服务端工具整理来源、证据缺口和下一步。
- Result: 系统写入 `morning_session`、`daily_lead`、`follow_up_task`、`agent_run` 和 `replay_timeline`。
- Inspection: 打开线索详情，看排序理由、缺证据项、人审边界、待办和处置回放。

## Demo loop

1. 打开 `/morning`。
2. 修改“今天先看什么”，比如优先看重点机构或昨日未回访。
3. 点 `开晨会`。
4. 打开第一条线索。
5. 点 `退回补证` 或 `派核验`。
6. 查看线索状态、待办和回放。

CSV 还在，但它只属于 `/import` 采集箱，用来补一批来源。产品首页从晨会开始。

## Pitch materials

- Deck: `docs/deck/jiaxu-deck.pdf`、`docs/deck/jiaxu-deck.pptx`
- Pitch+Demo video: `docs/video/pitch-demo-2.mp4`
- Video QA: `docs/video/pitch-demo/qa/summary.json`

## How it works

- Live provider: `src/lib/provider.ts`
- Morning planning and state writer: `src/lib/agent/runMorningSessionAgent.ts`
- SQLite schema and persistence: `src/lib/db.ts`
- Morning APIs: `src/app/api/morning-sessions/*`
- Lead action API: `src/app/api/daily-leads/[id]/action/route.ts`
- Main UI: `src/app/morning/page.tsx`、`src/components/MorningWorkbench.tsx`

价序只写待办、核验、补证、观察等工作状态。发函、通报、违规认定和关闭线索必须由业务人员确认。

## Limits

- 演示数据是合成/脱敏数据，见 `src/lib/fixtures.ts` 和 `src/lib/seed.ts`。
- 当前没有接入真实省级招采平台、HIS、医院系统或生产工单。
- Provider 不可用时，系统写入失败态，不把本地规则包装成成功。

## Run locally

需要 Node 22 及以上。

```bash
npm install
npm run creds
npm run build
npm run start
```

本地默认地址：`http://localhost:3000/morning`

验证：

```bash
npm run smoke:jiaxu
npm run shots
```

最近一次 G4 验证：

- `npm run build` 通过。
- `DEMO_URL=http://127.0.0.1:3004 npm run smoke:jiaxu` 通过，9/9。
- `DEMO_URL=http://127.0.0.1:3004 npm run shots` 通过。
- 失败态截图：`docs/screenshots/10-morning-provider-failure.png`。
