#!/usr/bin/env node
// Workspace smoke: reset data -> attach demo source -> run built-in prompt with
// live provider -> follow up -> verify durable workspace objects and reopen.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.HUNTER_DEV_PORT || "3000";
const BASE = process.env.DEMO_URL?.replace(/\/$/, "") || `http://127.0.0.1:${PORT}`;
const PROJECT = process.cwd();

async function post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${path} ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

function countLatest(snapshot, key, runId) {
  return (snapshot[key] || []).filter((x) => x.run_id === runId).length;
}

const main = async () => {
  await post("/api/admin/reseed", {});

  console.log("\n[smoke] attach demo source");
  const source = await post("/api/workspace/source", {
    kind: "demo",
    sourceId: "demo-price-sheet",
  });
  const threadId = source.snapshot.thread.id;
  const datasetId = source.snapshot.dataset.id;
  console.log(`  -> thread=${threadId} dataset=${datasetId} rows=${source.snapshot.dataset.row_count}`);

  console.log("\n[smoke] run built-in prompt");
  const first = await post("/api/workspace/run", {
    threadId,
    promptKey: "repair_price_batch",
    instruction:
      "请核完并修复这批价格数据。能确定的字段和单位先修复；拿不准的问我；可以处置的生成机构核实口径和流程任务。",
  });
  if (!first.runId) throw new Error(`first run missing runId: ${JSON.stringify(first)}`);
  const firstSnapshot = first.snapshot;
  const providerStatus = firstSnapshot.thread.provider_status;
  console.log(
    `  -> run=${first.runId} ok=${first.ok} state=${first.state} provider=${providerStatus} hash=${first.output_hash}`,
  );

  console.log("\n[smoke] follow-up instruction changes workflow");
  const follow = await post("/api/workspace/run", {
    threadId,
    instruction: "把重点机构放前面，缺包装单位的先转数据治理确认。",
  });
  if (!follow.runId) throw new Error(`follow-up run missing runId: ${JSON.stringify(follow)}`);
  const followSnapshot = follow.snapshot;
  console.log(`  -> run=${follow.runId} state=${follow.state} hash=${follow.output_hash}`);

  const reopened = await get(`/api/workspace/threads/${threadId}`);

  console.log("\n[smoke] upload CSV context");
  const upload = await post("/api/workspace/source", {
    kind: "upload",
    fileName: "smoke-price.csv",
    title: "烟测上传价格表",
    csv:
      "医保项目编码,药品/耗材名称,价格日期,采购渠道,地区,机构执行价,机构名称\n" +
      "YP-AXL-O01,阿莫西林胶囊 0.25g*24粒,2026-06-22,省级挂网,上海市,9.20,市人民医院\n" +
      "HC-STN-901,冠脉药物洗脱支架,2026-06-22,集采中选-省平台,上海市,660.00,省立医院\n",
  });

  const firstTasks = firstSnapshot.workflowTasks || [];
  const followTasks = followSnapshot.workflowTasks || [];
  const changedTasks = followTasks.filter(
    (t) => t.task_type === "数据治理确认" || t.priority === "high",
  );
  const firstRunEvents = (firstSnapshot.runEvents || []).filter((e) => e.run_id === first.runId);
  const followRunEvents = (followSnapshot.runEvents || []).filter((e) => e.run_id === follow.runId);

  const assertions = {
    demo_source_attached: Boolean(source.snapshot.thread && source.snapshot.dataset?.row_count >= 8),
    csv_upload_attached: Boolean(upload.snapshot.thread && upload.snapshot.dataset?.row_count === 2),
    first_run_success: first.ok === true && first.state,
    live_provider: firstSnapshot.thread.provider_status === "live-provider",
    persisted_field_mapping: countLatest(firstSnapshot, "fieldMappings", first.runId) >= 6,
    persisted_repair_patch: countLatest(firstSnapshot, "repairPatches", first.runId) >= 1,
    persisted_match_group: countLatest(firstSnapshot, "matchGroups", first.runId) >= 2,
    persisted_workflow_tasks: firstTasks.length >= 2,
    persisted_drafts: countLatest(firstSnapshot, "institutionDrafts", first.runId) >= 1,
    needs_user_question: firstSnapshot.thread.state === "needs_user",
    followup_success: follow.ok === true && Boolean(follow.runId),
    followup_changed_tasks: changedTasks.length >= 1,
    different_output_hash: first.output_hash !== follow.output_hash,
    reopen_thread: reopened.snapshot.thread.id === threadId && reopened.snapshot.messages.length >= 4,
    run_events_saved: firstRunEvents.length >= 4 && followRunEvents.length >= 4,
  };

  const passed = Object.values(assertions).every(Boolean);
  const passCount = Object.values(assertions).filter(Boolean).length;
  const total = Object.values(assertions).length;

  mkdirSync(join(PROJECT, ".hunter"), { recursive: true });
  const evidence = {
    generated_at: new Date().toISOString(),
    base_url: BASE,
    mode: "conversation-first price-governance workspace",
    source: {
      thread_id: threadId,
      dataset_id: datasetId,
      rows: source.snapshot.dataset.row_count,
    },
    runs: [
      {
        thread_id: threadId,
        run_id: first.runId,
        instruction: "核完并修复这批价格数据",
        provider_status: firstSnapshot.thread.provider_status,
        output_hash: first.output_hash,
        field_mappings: countLatest(firstSnapshot, "fieldMappings", first.runId),
        repair_patches: countLatest(firstSnapshot, "repairPatches", first.runId),
        match_groups: countLatest(firstSnapshot, "matchGroups", first.runId),
        workflow_tasks: firstTasks.length,
        drafts: countLatest(firstSnapshot, "institutionDrafts", first.runId),
      },
      {
        thread_id: threadId,
        run_id: follow.runId,
        instruction: "重点机构优先，缺包装单位先转数据治理确认",
        provider_status: followSnapshot.thread.provider_status,
        output_hash: follow.output_hash,
        changed_tasks: changedTasks.length,
        workflow_tasks: followTasks.length,
      },
    ],
    upload: {
      thread_id: upload.snapshot.thread.id,
      rows: upload.snapshot.dataset.row_count,
    },
    assertions,
    pass_count: passCount,
    total,
    passed,
  };

  writeFileSync(
    join(PROJECT, ".hunter", "agent-runs.json"),
    JSON.stringify(evidence.runs, null, 2),
  );
  writeFileSync(
    join(PROJECT, ".hunter", "live-provider-smoke.json"),
    JSON.stringify(evidence, null, 2),
  );

  console.log("\n[assertions]");
  for (const [k, v] of Object.entries(assertions)) console.log(`  ${v ? "PASS" : "FAIL"}  ${k}`);
  console.log(`\n[smoke] ${passed ? "ALL PASS" : "FAILED"} ${passCount}/${total}`);
  process.exit(passed ? 0 : 1);
};

main().catch((e) => {
  console.error("[smoke] error:", e.message);
  process.exit(1);
});
