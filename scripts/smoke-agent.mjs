#!/usr/bin/env node
// Two required live smokes (PRD 12.2). Runs against the dev server so the real
// server-side provider path executes. Saves evidence and asserts the outputs
// differ in plan / tools / approval boundary / release state / output hash.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.HUNTER_DEV_PORT || "3000";
const BASE = process.env.DEMO_URL?.replace(/\/$/, "") || `http://127.0.0.1:${PORT}`;
const PROJECT = process.cwd();
const RELEASE = "REL-2026-0623-07";

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function runSmoke(name, payload) {
  console.log(`\n[smoke ${name}] ${JSON.stringify(payload)}`);
  const result = await post("/api/agent/release-gate", payload);
  if (!result.runId) throw new Error(`smoke ${name} did not return runId: ${JSON.stringify(result)}`);
  const detail = await get(`/api/run/${result.runId}`);
  const run = detail.run;
  console.log(
    `  -> state=${run.result_state} status=${run.status} focus=${run.plan.issue_focus} ` +
      `tools=[${run.tools.map((t) => t.tool).join(",")}] hash=${run.output_hash} ` +
      `provider=${run.provider_meta.source}/${run.provider_meta.model ?? "-"} (${run.provider_meta.latency_ms ?? "-"}ms)`,
  );
  return { result, detail };
}

const main = async () => {
  // clean slate
  await post("/api/admin/reseed", {});

  const A = await runSmoke("A wrong-code(BAD-X999)", {
    releaseId: RELEASE,
    mutationType: "wrong_code",
    override: { catalog_code: "BAD-X999" },
  });
  const B = await runSmoke("B access-denied(外部分析员/对外共享)", {
    releaseId: RELEASE,
    mutationType: "access_denied",
  });

  const a = A.detail.run;
  const b = B.detail.run;
  const aTools = a.tools.map((t) => t.tool);
  const bTools = b.tools.map((t) => t.tool);

  const assertions = {
    a_success: a.status === "success",
    b_success: b.status === "success",
    a_live_provider: a.provider_meta.source === "live-provider",
    b_live_provider: b.provider_meta.source === "live-provider",
    different_output_hash: a.output_hash !== b.output_hash,
    different_result_state: a.result_state !== b.result_state,
    different_writer_tools:
      aTools.includes("quarantine_writer") && bTools.includes("approval_router"),
    a_state_isolated_or_correctable: a.result_state === "隔离" || a.result_state === "纠错候选",
    b_state_needs_approval: b.result_state === "需审批",
    b_has_pending_approval: B.detail.approvals.some((x) => x.status === "pending"),
    at_least_3_tools: aTools.length >= 3 && bTools.length >= 3,
  };

  const passed = Object.values(assertions).every(Boolean);

  const agentRuns = [A, B].map(({ detail }) => ({
    run_id: detail.run.id,
    release_id: detail.run.release_id,
    input: detail.run.input_summary,
    mutation_type: detail.run.mutation_type,
    result_state: detail.run.result_state,
    status: detail.run.status,
    plan: detail.run.plan,
    tools_called: detail.run.tools.map((t) => t.tool),
    provider_meta: detail.run.provider_meta,
    output_hash: detail.run.output_hash,
    duration_ms: detail.run.duration_ms,
    evidence: {
      issues: detail.issues.length,
      corrections: detail.corrections.length,
      quarantine: detail.quarantine.length,
      approvals: detail.approvals.length,
      replay_events: detail.replay.length,
    },
  }));

  mkdirSync(join(PROJECT, ".hunter"), { recursive: true });
  writeFileSync(join(PROJECT, ".hunter", "agent-runs.json"), JSON.stringify(agentRuns, null, 2));
  writeFileSync(
    join(PROJECT, ".hunter", "live-provider-smoke.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        base_url: BASE,
        smokeA: {
          input: { mutationType: "wrong_code", override: { catalog_code: "BAD-X999" } },
          result_state: a.result_state,
          plan_focus: a.plan.issue_focus,
          tools: aTools,
          provider_meta: a.provider_meta,
          output_hash: a.output_hash,
        },
        smokeB: {
          input: { mutationType: "access_denied" },
          result_state: b.result_state,
          plan_focus: b.plan.issue_focus,
          tools: bTools,
          provider_meta: b.provider_meta,
          output_hash: b.output_hash,
        },
        assertions,
        passed,
      },
      null,
      2,
    ),
  );

  console.log("\n[assertions]");
  for (const [k, v] of Object.entries(assertions)) console.log(`  ${v ? "PASS" : "FAIL"}  ${k}`);
  console.log(`\n[smoke] ${passed ? "ALL PASS" : "FAILED"} — evidence in .hunter/agent-runs.json + .hunter/live-provider-smoke.json`);
  process.exit(passed ? 0 : 1);
};

main().catch((e) => {
  console.error("[smoke] error:", e.message);
  process.exit(1);
});
