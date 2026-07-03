#!/usr/bin/env node
// V2/V2.2 端到端验证：政策同步留痕 → 政策事实 → 政策更新 → 漂移检出 → 漂移复核任务
// → 人审反馈（final_action）→ 规则挖掘 → dry-run → 人审激活 → 下批自动处置 → 决策日志。
// 只读+演示写入，全部走公开 API；结果写 .hunter/v2-verification.json。

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.DEMO_URL || "http://127.0.0.1:3400").replace(/\/$/, "");
const PROJECT = process.cwd();

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json };
}
const get = (p) => call("GET", p);
const post = (p, b = {}) => call("POST", p, b);

const checks = {};
const notes = {};
function check(name, ok, note) {
  checks[name] = Boolean(ok);
  if (note !== undefined) notes[name] = note;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note !== undefined ? `  (${typeof note === "string" ? note : JSON.stringify(note)})` : ""}`);
}

const main = async () => {
  console.log(`[v2-verify] base=${BASE}`);
  await post("/api/admin/reseed");

  // ---------- 1. 政策事实 baseline ----------
  console.log("\n[1] policy facts baseline");
  const facts = await get("/api/workspace/policy-facts");
  const factRows = facts.json?.facts ?? facts.json?.items ?? [];
  check("policy_facts_seeded", facts.status === 200 && factRows.length >= 6, `count=${factRows.length}`);

  // ---------- 2. 政策同步（dry-run，真实抓取国家医保局公告页） ----------
  console.log("\n[2] policy sync (dry-run fetch)");
  const sync = await post("/api/workspace/policy-sync", { dryRun: true });
  check(
    "policy_sync_dry_run",
    sync.status === 200 && sync.json?.ok === true && (sync.json?.fetchedCount ?? 0) > 0,
    `status=${sync.status} fetched=${sync.json?.fetchedCount ?? sync.json?.message}`,
  );

  // ---------- 3. 首次 agent run（产生 disposition / task / decision log） ----------
  console.log("\n[3] first agent run");
  const source = await post("/api/workspace/source", { kind: "demo", sourceId: "demo-price-sheet" });
  const threadId = source.json?.snapshot?.thread?.id;
  const run1 = await post("/api/workspace/run", {
    threadId,
    promptKey: "repair_price_batch",
    instruction: "请核完并修复这批价格数据，可以处置的生成机构核实口径和流程任务。",
  });
  check("first_run_ok", run1.json?.ok === true, `state=${run1.json?.state} provider=${run1.json?.snapshot?.thread?.provider_status}`);
  const snap1 = run1.json?.snapshot ?? {};
  const tasks1 = snap1.workflowTasks ?? [];
  check("run_created_tasks", tasks1.length >= 2, `tasks=${tasks1.length}`);

  const log0 = await get("/api/workspace/decision-log?limit=100");
  const log0Rows = log0.json?.decisions ?? [];
  check("decision_log_guardrail_entries", log0Rows.length >= 1, `entries=${log0Rows.length}`);

  // ---------- 4. 政策更新 → 漂移检出 ----------
  console.log("\n[4] policy update -> drift on next run");
  const upd = await post("/api/workspace/policy-update", { itemCode: "HC-LNS-902", collective_price: 560 });
  check("policy_update_ok", upd.status === 200 && upd.json?.ok === true, upd.json?.message);

  const run2 = await post("/api/workspace/run", { threadId, instruction: "按最新政策口径再核一遍这批数据。" });
  check("second_run_ok", run2.json?.ok === true, `state=${run2.json?.state}`);
  const drifts = await get("/api/workspace/policy-drifts");
  const driftRows = drifts.json?.drifts ?? [];
  check("drift_detected_after_update", driftRows.length >= 1, `drifts=${driftRows.length} kinds=${[...new Set(driftRows.map((d) => d.rule_key))].join(",")}`);

  const snap2 = run2.json?.snapshot ?? {};
  const tasks2 = snap2.workflowTasks ?? [];
  const driftTasks = tasks2.filter((t) => t.task_type === "政策漂移复核");
  check("drift_review_task_created", driftTasks.length >= 1, `driftTasks=${driftTasks.length}`);

  // ---------- 5. 人审反馈 x3+（同 issue_type/severity/final_action → 可挖掘模式） ----------
  // 挖掘要求同 (issue_type, severity, final_action) 的一致人审且 support>=3。
  // 选 price_spike/medium：唯一非敏感、护栏可过的模式（其余高危/集采/编码类一律被护栏留在人审）。
  console.log("\n[5] human decisions with final_action");
  const decidable = tasks2.filter((t) => !["已人审确认", "已驳回", "自动处置"].includes(t.status));
  const dispById = new Map((snap2.dispositionItems ?? []).map((d) => [d.id, d]));
  const spikeTasks = decidable.filter((t) => {
    const d = t.disposition_id ? dispById.get(t.disposition_id) : null;
    return Boolean(d && d.issue_type === "price_spike");
  });
  let approved = 0;
  for (const t of spikeTasks.slice(0, 4)) {
    const d = await post(`/api/workspace/tasks/${t.id}/decision`, {
      decision: "approve",
      final_action: "机构核实",
      reviewer: "价格治理审核员",
      notes: "verify-v2 演示决策：中危价格涨幅统一按机构核实处置",
    });
    if (d.json?.ok) approved += 1;
  }
  // 顺带人审一条漂移复核任务：验证漂移队列 resolved 流转（单条不影响挖掘桶）。
  const driftTask = decidable.find((t) => t.task_type === "政策漂移复核");
  if (driftTask) {
    await post(`/api/workspace/tasks/${driftTask.id}/decision`, {
      decision: "approve",
      final_action: "集采落地催办",
      reviewer: "价格治理审核员",
      notes: "verify-v2 漂移复核",
    });
  }
  check("task_decisions_logged", approved >= 3, `approved=${approved} pattern=price_spike/medium spikeTasks=${spikeTasks.length}`);

  // ---------- 6. 规则挖掘 → dry-run → 激活 ----------
  console.log("\n[6] mine -> dry-run -> ratify");
  const mine = await post("/api/workspace/rule-candidates", { action: "mine", minSupport: 3, minConfidence: 0.8 });
  check("mine_proposed_candidate", mine.json?.ok === true && (mine.json?.proposed ?? 0) >= 1, `proposed=${mine.json?.proposed} scanned=${mine.json?.scannedDecisions}`);

  const pending = await get("/api/workspace/rule-candidates?status=pending_review");
  const cand = (pending.json?.candidates ?? [])[0];
  check("candidate_listed", Boolean(cand), cand ? `id=${cand.id} conf=${cand.confidence} support=${cand.support_count}` : "none");

  if (cand) {
    const dry = await get(`/api/workspace/rule-candidates/${cand.id}/dry-run`);
    const dryOk = dry.status === 200 && dry.json?.ok === true;
    check("candidate_dry_run", dryOk, dry.json);
    const ratify = await post(`/api/workspace/rule-candidates/${cand.id}/decision`, {
      decision: "approve",
      reviewer: "价格治理审核员",
      notes: "verify-v2 激活",
    });
    check("candidate_ratified", ratify.json?.ok === true || ratify.status === 200, ratify.json?.message ?? ratify.status);
  } else {
    check("candidate_dry_run", false, "no candidate");
    check("candidate_ratified", false, "no candidate");
  }

  // ---------- 7. 下批 run 自动处置（学习规则复用） ----------
  console.log("\n[7] next run applies learned rule");
  const run3 = await post("/api/workspace/run", { threadId, instruction: "再按当前规则处理一遍，能自动处置的自动处置。" });
  const snap3 = run3.json?.snapshot ?? {};
  const events3 = (snap3.runEvents ?? []).filter((e) => e.run_id === run3.json?.runId);
  const learnEvent = events3.find((e) => e.phase === "learn");
  const autoTasks = (snap3.workflowTasks ?? []).filter((t) => t.status === "自动处置");
  check("learned_rule_applied", Boolean(learnEvent) && autoTasks.length >= 1, `learnEvent=${learnEvent ? "yes" : "no"} autoTasks=${autoTasks.length}`);

  // ---------- 8. 审计闭环 ----------
  console.log("\n[8] audit trail");
  const log1 = await get("/api/workspace/decision-log?limit=100");
  const log1Rows = log1.json?.decisions ?? [];
  const kinds = new Set(log1Rows.map((r) => r.decision));
  check(
    "decision_log_full_loop",
    kinds.has("human_approved") && (kinds.has("auto_approved") || kinds.has("needs_human")),
    `decisions=${[...kinds].join(",")}`,
  );

  const artifacts = await get("/api/workspace/policy-artifacts");
  check("policy_artifacts_endpoint", artifacts.status === 200, `status=${artifacts.status}`);

  // ---------- 汇总 ----------
  const passCount = Object.values(checks).filter(Boolean).length;
  const total = Object.values(checks).length;
  const passed = passCount === total;
  mkdirSync(join(PROJECT, ".hunter"), { recursive: true });
  writeFileSync(
    join(PROJECT, ".hunter", "v2-verification.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), base_url: BASE, checks, notes, pass_count: passCount, total, passed }, null, 2),
  );
  console.log(`\n[v2-verify] ${passed ? "ALL PASS" : "FAILED"} ${passCount}/${total}`);
  process.exit(passed ? 0 : 1);
};

main().catch((e) => {
  console.error("[v2-verify] error:", e);
  process.exit(1);
});
