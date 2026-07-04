"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Button, TextArea } from "@radix-ui/themes";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  LightningBoltIcon,
  Link2Icon,
  LoopIcon,
  PaperPlaneIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import type { ProviderStatus } from "@/lib/env";
import type {
  ConversationMessage,
  FieldMapping,
  MatchGroup,
  RepairPatch,
  RunEvent,
  UploadedDataset,
  WorkspaceSnapshot,
} from "@/lib/types";
import { DEMO_SOURCES } from "@/lib/workspace/demoSources";
import { DesktopPet } from "@/components/DesktopPet";

// V2.2 收窄：hero prompt 主打"政策变更后的存量机构执行价复核"，其余为扩展场景。
const PROMPTS: { key: string; label: string; text: string; hero?: boolean }[] = [
  {
    key: "drift_review_loop",
    label: "核完并闭环处置这批机构执行价异常",
    text: "请对照最新政策事实核完这批机构执行价：检出政策漂移并生成复核任务；命中已激活规则的直接自动处置；其余转人审；人审结论沉淀为规则候选。",
    hero: true,
  },
  {
    key: "repair_price_batch",
    label: "核完并修复这批价格数据",
    text: "请核完并修复这批价格数据。能确定的字段和单位先修复；拿不准的问我；可以处置的生成机构核实口径和流程任务。",
  },
  {
    key: "collective_landing",
    label: "找出集采落地差异并生成催办口径",
    text: "请找出集采落地差异，并生成需要催办的机构口径和内部流程任务。",
  },
  {
    key: "data_governance",
    label: "生成需要发起的数据治理确认",
    text: "请生成需要发起的数据治理确认。缺字段、缺包装单位和编码不稳的项先不要催医院。",
  },
];

// 业务对象 tab（V2.2：技术对象名 → 价格治理岗的业务对象名）
const OBJECT_TABS = [
  { key: "drift", label: "政策变化风险" },
  { key: "task", label: "人审任务" },
  { key: "draft", label: "处置建议卡" },
  { key: "rule", label: "待审规则" },
  { key: "fact", label: "政策依据" },
  { key: "repair", label: "数据修复" },
] as const;
type ObjectTabKey = (typeof OBJECT_TABS)[number]["key"];
// run 之后自动切换只考虑 run 产物（政策事实常驻非空，不参与切换判定）
const AUTO_SWITCH_ORDER: ObjectTabKey[] = ["drift", "task", "draft", "repair"];

// 人审批准时可选的实际处置动作（final_action，规则挖掘的聚合键之一）
const FINAL_ACTIONS = ["机构核实", "集采催办", "转数据治理", "排除（误报）"] as const;
type PetSyncState = "running" | "needs" | "failed" | "degraded" | "ready" | "idle";

function threadStateLabel(state: string) {
  if (state === "needs_user") return "待人工确认";
  if (state === "running") return "正在核查";
  if (state === "complete") return "已形成结果";
  if (state === "failed") return "核查失败";
  return "待接入数据";
}

interface DriftRow {
  id: string;
  item_code: string;
  rule_key: string;
  severity: string;
  drift_type: string;
  drift_score: number;
  baseline_json: string;
  observed_json: string;
  status: string;
  run_id: string | null;
}

interface RuleRow {
  id: string;
  status: string;
  trigger_json: string;
  proposed_action_json: string;
  confidence: number;
  support_count: number;
  hit_count: number;
  source_decision_ids_json: string | null;
  provenance_run_id: string | null;
}

interface FactRow {
  id: string;
  item_code: string;
  item_name: string;
  reference_price: number | null;
  ceiling_price: number | null;
  collective_price: number | null;
  source_hash: string | null;
}

interface ArtifactRow {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  content_hash: string;
  status: string;
}

interface DecisionRow {
  id: string;
  decision: string;
  target_type: string;
  target_id: string;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
}

interface GovernanceMetrics {
  totalDecisions: number;
  autoApproved: number;
  needsHuman: number;
  humanApproved: number;
  humanRejected: number;
  autoRate: number;
  activeRules: number;
  pendingRules: number;
  suspendedRules: number;
  ruleHits: number;
  driftsDetected: number;
  driftsResolved: number;
  driftsOpen: number;
  factCount: number;
  policyFingerprint: string | null;
  workspaceRuns: number;
  avgRunMs: number | null;
  estimatedMinutesSaved: number;
  savingAssumption: string;
}

interface IngestionInfo {
  status: string;
  finished_at: string | null;
  fetched_count: number;
  changed_count: number;
}

interface PolicyData {
  drifts: DriftRow[];
  rules: RuleRow[];
  facts: FactRow[];
  artifacts: ArtifactRow[];
  decisions: DecisionRow[];
  metrics: GovernanceMetrics | null;
  latestIngestion: IngestionInfo | null;
}

const EMPTY_POLICY: PolicyData = {
  drifts: [],
  rules: [],
  facts: [],
  artifacts: [],
  decisions: [],
  metrics: null,
  latestIngestion: null,
};

interface WorkspaceClientProps {
  initialSnapshot: WorkspaceSnapshot;
  providerStatus: ProviderStatus;
}

export function WorkspaceClient({ initialSnapshot, providerStatus }: WorkspaceClientProps) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(initialSnapshot);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState<"source" | "run" | null>(null);
  const [error, setError] = useState("");
  const [runningText, setRunningText] = useState("");
  const [pendingInstruction, setPendingInstruction] = useState("");
  const [activeTab, setActiveTab] = useState<ObjectTabKey>("fact");
  const [policy, setPolicy] = useState<PolicyData>(EMPTY_POLICY);
  const [policyMsg, setPolicyMsg] = useState("");
  const [policyBusy, setPolicyBusy] = useState(false);
  // 桌面小宠物：记录最近一次 run 的结果，供它闪现开心/担忧心情。
  const [lastRunStatus, setLastRunStatus] = useState<
    "success" | "degraded" | "failed" | null
  >(null);
  const [lastRunEndedAt, setLastRunEndedAt] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const dataset = snapshot.dataset;
  const thread = snapshot.thread;
  const latestRunId = snapshot.runEvents.at(-1)?.run_id ?? null;
  const needsUser = thread?.state === "needs_user";
  const messages = useMemo(() => {
    const base = snapshot.messages ?? [];
    if (!runningText) return base;
    // run 期间乐观展示：用户刚发的指令 + agent 的即时应答，保持对话时间线连续。
    const nowIso = new Date().toISOString();
    const optimistic: ConversationMessage[] = [];
    if (pendingInstruction) {
      optimistic.push({
        id: "optimistic-user",
        thread_id: thread?.id ?? "",
        role: "user",
        content: pendingInstruction,
        meta_json: "{}",
        created_at: nowIso,
      });
    }
    optimistic.push({
      id: "optimistic-running",
      thread_id: thread?.id ?? "",
      role: "assistant",
      content: runningText,
      meta_json: "{}",
      created_at: nowIso,
    });
    return [...base, ...optimistic];
  }, [runningText, pendingInstruction, snapshot.messages, thread?.id]);

  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages.length, runningText]);

  const refreshPolicy = useCallback(async (): Promise<PolicyData> => {
    try {
      const [dRes, rRes, fRes, aRes, lRes, mRes] = await Promise.all([
        fetch("/api/workspace/policy-drifts"),
        fetch("/api/workspace/rule-candidates"),
        fetch("/api/workspace/policy-facts"),
        fetch("/api/workspace/policy-artifacts"),
        fetch("/api/workspace/decision-log?limit=8"),
        fetch("/api/workspace/metrics"),
      ]);
      const [dj, rj, fj, aj, lj, mj] = await Promise.all([
        dRes.json(), rRes.json(), fRes.json(), aRes.json(), lRes.json(), mRes.json(),
      ]);
      const next: PolicyData = {
        drifts: dj.drifts ?? [],
        rules: rj.candidates ?? [],
        facts: fj.facts ?? [],
        artifacts: aj.artifacts ?? [],
        decisions: lj.decisions ?? [],
        metrics: mj.metrics ?? null,
        latestIngestion: aj.latestIngestion ?? null,
      };
      setPolicy(next);
      return next;
    } catch {
      return EMPTY_POLICY;
    }
  }, []);

  useEffect(() => {
    void refreshPolicy();
  }, [refreshPolicy]);

  async function refreshSnapshot(threadId?: string) {
    const id = threadId ?? snapshot.thread?.id;
    if (!id) return;
    try {
      const res = await fetch(`/api/workspace/threads/${id}`);
      const data = (await res.json()) as { ok: boolean; snapshot?: WorkspaceSnapshot };
      if (data.ok && data.snapshot) setSnapshot(data.snapshot);
    } catch {
      // ignore
    }
  }

  async function connectDemo(sourceId: string) {
    setBusy("source");
    setError("");
    try {
      const res = await fetch("/api/workspace/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "demo", sourceId }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; snapshot?: WorkspaceSnapshot };
      if (!data.ok || !data.snapshot) throw new Error(data.message || "演示数据源接入失败。");
      setSnapshot(data.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "演示数据源接入失败。");
    } finally {
      setBusy(null);
    }
  }

  async function uploadFile(file: File) {
    setBusy("source");
    setError("");
    try {
      if (/\.xlsx$/i.test(file.name)) {
        throw new Error("当前演示先支持 CSV 表格，电子表格入口已预留。请先另存为 CSV，或使用演示数据源。");
      }
      const csv = await file.text();
      const res = await fetch("/api/workspace/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "upload",
          fileName: file.name,
          title: file.name.replace(/\.[^.]+$/, "") || "上传价格表",
          csv,
        }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; snapshot?: WorkspaceSnapshot };
      if (!data.ok || !data.snapshot) throw new Error(data.message || "上传失败。");
      setSnapshot(data.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败。");
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function runInstruction(text: string, promptKey: string | null = null, threadIdOverride?: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const threadId = threadIdOverride ?? snapshot.thread?.id;
    if (!threadId) {
      setError("先上传表格或连接一个演示数据源。");
      return;
    }
    setBusy("run");
    setError("");
    setPendingInstruction(trimmed);
    setRunningText("我会先对照最新政策事实核价，再决定哪些漂移要人审、哪些能按激活规则自动处置、哪些要问你。");
    try {
      const res = await fetch("/api/workspace/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          instruction: trimmed,
          promptKey,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        runId?: string;
        snapshot?: WorkspaceSnapshot;
        error_category?: string;
      };
      if (!data.snapshot) throw new Error(data.message || "价序没有返回本次核查状态。");
      setSnapshot(data.snapshot);
      setComposer("");
      if (!data.ok && data.error_category) {
        setError(`智能研判异常：${data.error_category}。可确定的核查结果已保留。`);
        setLastRunStatus("degraded");
      } else {
        setLastRunStatus("success");
      }
      setLastRunEndedAt(Date.now());
      // run 后刷新政策数据：本次检出漂移则自动切到漂移队列，否则切人审任务。
      const fresh = await refreshPolicy();
      const runDrifts = data.runId ? fresh.drifts.filter((d) => d.run_id === data.runId) : [];
      if (runDrifts.length > 0) {
        setActiveTab("drift");
      } else if ((data.snapshot.workflowTasks ?? []).some((t) => t.run_id === data.runId)) {
        setActiveTab("task");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "价序核查失败。");
      setLastRunStatus("failed");
      setLastRunEndedAt(Date.now());
    } finally {
      setRunningText("");
      setPendingInstruction("");
      setBusy(null);
    }
  }

  function usePrompt(prompt: (typeof PROMPTS)[number]) {
    setComposer(prompt.text);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  /*
   * Landing deep-link: /workspace?prompt=<key>&text=<instruction>
   * If the active thread has no dataset, first connect the demo price sheet
   * (so judges don't have to pick a source before the prompt runs),
   * then run the requested prompt. Runs once per query string.
   */
  const searchParams = useSearchParams();
  const pendingPromptRef = useRef<{ key: string; text: string } | null>(null);
  useEffect(() => {
    const key = searchParams.get("prompt");
    const text = searchParams.get("text");
    if (!key || !text) return;
    if (pendingPromptRef.current) return;
    pendingPromptRef.current = { key, text };

    const hasContext = Boolean(snapshot.dataset && snapshot.thread?.id);
    const run = async () => {
      let activeSnapshot = snapshot;
      if (!hasContext) {
        try {
          const res = await fetch("/api/workspace/source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "demo", sourceId: "demo-price-sheet" }),
          });
          const data = (await res.json()) as {
            ok: boolean;
            message?: string;
            snapshot?: WorkspaceSnapshot;
          };
          if (data.ok && data.snapshot) {
            setSnapshot(data.snapshot);
            activeSnapshot = data.snapshot;
          } else {
            setError(data.message || "无法连接演示数据源，请手动选择数据源后再发起核查。");
            return;
          }
        } catch {
          setError("无法连接演示数据源，请手动选择数据源后再发起核查。");
          return;
        }
      }
      const threadId = activeSnapshot.thread?.id;
      if (!threadId) {
        setError("没有可用的对话线程。");
        return;
      }
      setComposer(text);
      void runInstruction(text, key, threadId);
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const threadState = thread?.state ?? "idle";
  const isRunning = busy === "run";

  const mappings = latestOnly(snapshot.fieldMappings, latestRunId);
  const repairs = latestOnly(snapshot.repairPatches, latestRunId);
  const groups = latestOnly(snapshot.matchGroups, latestRunId);
  const tasks = latestOnly(snapshot.workflowTasks, latestRunId);
  const drafts = latestOnly(snapshot.institutionDrafts, latestRunId);
  const events = latestOnly(snapshot.runEvents, latestRunId);

  // 最近一次 run 的执行步骤应插在"该 run 的 assistant 回答"之前（时间线位置）。
  // 找不到对应回答（例如刚完成、消息还没刷出）就放到消息末尾。
  const stepsBeforeIndex = (() => {
    if (events.length === 0) return -1;
    const idx = messages.findIndex((m) => {
      if (m.role !== "assistant") return false;
      try {
        return (JSON.parse(m.meta_json) as { run_id?: string }).run_id === latestRunId;
      } catch {
        return false;
      }
    });
    return idx === -1 ? messages.length : idx;
  })();

  const openDrifts = policy.drifts.filter((d) => d.status === "detected");
  const visibleRules = policy.rules.filter(
    (r) => r.status === "pending_review" || r.status === "active" || r.status === "suspended",
  );

  function interactWithDesktopPet(mood: "idle" | "running" | "needs_user" | "happy" | "worried") {
    if (mood === "running") {
      messageListRef.current?.scrollTo({
        top: messageListRef.current.scrollHeight,
        behavior: "smooth",
      });
      return;
    }
    if (mood === "needs_user") {
      setActiveTab("task");
      return;
    }
    if (mood === "happy") {
      const next = AUTO_SWITCH_ORDER.find((tab) => objectCounts[tab] > 0);
      if (next) setActiveTab(next);
      return;
    }
    if (mood === "worried") {
      setActiveTab(openDrifts.length > 0 ? "drift" : "task");
      return;
    }
    composerRef.current?.focus();
  }

  const objectCounts: Record<ObjectTabKey, number> = {
    drift: openDrifts.length,
    task: tasks.length,
    draft: drafts.length,
    rule: visibleRules.length,
    fact: policy.facts.length,
    repair: mappings.length + repairs.length + groups.length,
  };

  // 仅在 run 刚结束的那一刻检查：当前 tab 为空就切到第一个有产物的 tab。
  // 平时手动点空 tab（例如挖掘前的规则候选）不能被弹走。
  const prevRunningRef = useRef(false);
  useEffect(() => {
    const justFinished = prevRunningRef.current && !isRunning;
    prevRunningRef.current = isRunning;
    if (!justFinished) return;
    if (objectCounts[activeTab] > 0) return;
    const next = AUTO_SWITCH_ORDER.find((t) => objectCounts[t] > 0);
    if (next) setActiveTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, activeTab, objectCounts.drift, objectCounts.task, objectCounts.draft, objectCounts.repair]);

  // ===== 业务动作：人审任务决策 / 规则激活 / 政策同步与变更演示 / artifact 确认 =====

  async function decideTask(taskId: string, decision: "approve" | "reject", finalAction: string) {
    setPolicyBusy(true);
    try {
      const res = await fetch(`/api/workspace/tasks/${taskId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          final_action: decision === "approve" ? finalAction : undefined,
          reviewer: "价格治理审核员",
        }),
      });
      const j = await res.json();
      setPolicyMsg(j.message ?? "");
      await Promise.all([refreshSnapshot(), refreshPolicy()]);
    } finally {
      setPolicyBusy(false);
    }
  }

  async function decideRule(id: string, decision: "approve" | "reject" | "suspend" | "resume") {
    setPolicyBusy(true);
    try {
      await fetch(`/api/workspace/rule-candidates/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reviewer: "业务审核员" }),
      });
      const msgs: Record<string, string> = {
        approve: "规则已激活：下批同类非敏感项将自动处置（敏感项仍人审）。",
        reject: "候选已拒绝。",
        suspend: "规则已停用（可回滚）：下批同类项立即回到人工确认，停用动作已写入决策留痕。",
        resume: "规则已恢复激活：下批同类项恢复自动处置。",
      };
      setPolicyMsg(msgs[decision] ?? "");
      await refreshPolicy();
    } finally {
      setPolicyBusy(false);
    }
  }

  async function mineRules() {
    setPolicyBusy(true);
    try {
      const res = await fetch("/api/workspace/rule-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mine" }),
      });
      const j = await res.json();
      setPolicyMsg(
        j.ok
          ? `挖掘完成：扫描 ${j.scannedDecisions ?? 0} 条人审决策，提议 ${j.proposed} 条候选规则。`
          : "挖掘失败。",
      );
      await refreshPolicy();
    } finally {
      setPolicyBusy(false);
    }
  }

  async function syncPolicy() {
    setPolicyBusy(true);
    setPolicyMsg("正在同步国家医保局公开公告，并保存来源留痕…");
    try {
      const res = await fetch("/api/workspace/policy-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json();
      setPolicyMsg(j.ok ? j.message : `同步失败：${j.message}`);
      await refreshPolicy();
    } catch (e) {
      setPolicyMsg(`同步失败：${e instanceof Error ? e.message : "网络错误"}`);
    } finally {
      setPolicyBusy(false);
    }
  }

  async function demoPolicyUpdate() {
    setPolicyBusy(true);
    try {
      const res = await fetch("/api/workspace/policy-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemCode: "HC-LNS-902", collective_price: 560 }),
      });
      const j = await res.json();
      setPolicyMsg(
        j.ok
          ? "政策依据已变更：HC-LNS-902 集采中选价 640→560。再次点击常用任务核查，即可看到存量执行价风险。"
          : j.message,
      );
      await refreshPolicy();
    } finally {
      setPolicyBusy(false);
    }
  }

  async function confirmArtifact(artifactId: string, itemCode: string, collectivePrice: number | null) {
    setPolicyBusy(true);
    try {
      const res = await fetch(`/api/workspace/policy-artifacts/${artifactId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_code: itemCode,
          collective_price: collectivePrice ?? undefined,
          reviewer: "政策事实审核员",
        }),
      });
      const j = await res.json();
      setPolicyMsg(j.message ?? "");
      await refreshPolicy();
    } finally {
      setPolicyBusy(false);
    }
  }

  return (
    <main className="workspace-shell" data-workspace data-visual-lane="agent-workbench">
      <DesktopPet
        isRunning={isRunning}
        threadState={threadState}
        lastRunStatus={lastRunStatus}
        lastRunEndedAt={lastRunEndedAt}
        context={{
          driftCount: objectCounts.drift,
          taskCount: objectCounts.task,
          draftCount: objectCounts.draft,
          ruleCount: objectCounts.rule,
          repairCount: objectCounts.repair,
        }}
        onInteract={interactWithDesktopPet}
      />
      <section className="workspace-band">
        <div className="workspace-band-left">
          <img className="agent-mark-img" src="/brand/logomark.svg" alt="" aria-hidden />
          <div className="workspace-band-text">
            <div className="workspace-band-title">价序工作台 · 政策变更后的执行价复核</div>
            <div className="workspace-band-sub mono">
              <span className={`state state-${threadState}`}>{threadStateLabel(threadState)}</span>
              <span className="sep" aria-hidden>·</span>
              <span className="provider">
                <span className={`dot ${providerStatus.configured ? "ok" : "warn"}`} aria-hidden />
                {providerStatus.configured
                  ? "智能研判已接通"
                  : "智能研判未接通"}
              </span>
              {policy.metrics?.policyFingerprint && (
                <>
                  <span className="sep" aria-hidden>·</span>
                  <span
                    className="policy-version-chip"
                    data-policy-version
                    title={`政策依据版本：任一条政策依据变更，版本都会变化；每次核查结果可对账`}
                  >
                    政策 v#{policy.metrics.policyFingerprint}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="workspace-band-right">
          {thread?.id ? (
            <a
              className="report-link mono"
              href={`/workspace/report/${thread.id}`}
              target="_blank"
              rel="noreferrer"
              data-report-link
              title="生成本会话的处置结果单（可打印归档：批次、漂移、处置、决策日志、指纹）"
            >
              <FileTextIcon /> 处置结果单
            </a>
          ) : (
            <span
              className="report-link disabled mono"
              aria-disabled="true"
              title="接入数据并完成一次核查后生成处置结果单"
            >
              <FileTextIcon /> 处置结果单
            </span>
          )}
          <Badge
            color={isRunning ? "blue" : needsUser ? "amber" : dataset ? "green" : "gray"}
            variant="soft"
            radius="full"
            className="workspace-band-badge"
          >
            {isRunning ? (
              <>
                <LoopIcon className="spin" style={{ marginRight: 4 }} /> 正在核查
              </>
            ) : needsUser ? (
              "待人工确认"
            ) : dataset ? (
              <>
                <CheckCircledIcon style={{ marginRight: 4 }} /> 数据已接入
              </>
            ) : (
              "先接入数据"
            )}
          </Badge>
        </div>
      </section>

      {policy.metrics && <GovernanceMetricsStrip metrics={policy.metrics} />}

      <section className="workspace-grid">
        {/* LEFT: conversation pane */}
        <div className="conversation-pane">
          <PetSyncStrip
            isRunning={isRunning}
            needsUser={needsUser}
            lastRunStatus={lastRunStatus}
            objectCounts={objectCounts}
            activeTab={activeTab}
          />
          <div className="message-list" ref={messageListRef} aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-conversation">
                <ReaderIcon />
                <strong>先接入一批机构执行价</strong>
                <span>上传表格，或连接右侧演示数据源。接入后点一句常用任务，价序会先核政策、再给出处置对象。</span>
              </div>
            ) : (
              <>
                {/* 严格按时间顺序渲染；最近一次 run 的执行步骤内联在它的回答之前，像 coding agent */}
                {messages.map((m, i) => (
                  <Fragment key={m.id}>
                    {i === stepsBeforeIndex && <AgentStepsMessage events={events} running={false} />}
                    <MessageBubble message={m} />
                  </Fragment>
                ))}
                {stepsBeforeIndex === messages.length && !isRunning && (
                  <AgentStepsMessage events={events} running={false} />
                )}
                {/* run 进行中：在时间线末尾流式展示执行阶段 */}
                {isRunning && <AgentStepsMessage events={[]} running />}
              </>
            )}
          </div>

          <section className="workspace-prompt-rail" aria-label="内置业务任务">
            <span className="rail-label mono" aria-hidden>
              <LightningBoltIcon /> 常用任务
            </span>
            <div className="rail-chips">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt.key}
                  type="button"
                  data-prompt-chip
                  data-prompt-key={prompt.key}
                  className={`prompt-chip${prompt.hero ? " hero" : ""}`}
                  title="填入输入框，确认后再开始核查"
                  disabled={busy === "run"}
                  onClick={() => usePrompt(prompt)}
                >
                  {prompt.label}
                </button>
              ))}
            </div>
          </section>

          <div className="composer" data-conversation-composer>
            {dataset && (
              <div className="composer-context">
                <CheckCircledIcon />
                <span>
                  已接入：<strong>{dataset.title}</strong>
                  <span className="mono" style={{ marginLeft: 8, color: "var(--ink-3)" }}>
                    {dataset.row_count} 行
                  </span>
                </span>
              </div>
            )}
            <TextArea
              ref={composerRef}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="直接说要核什么，比如：把这批执行价按最新政策复核一遍。"
              size="3"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void runInstruction(composer);
                }
              }}
            />
            <div className="composer-actions">
              <span className="mono">Ctrl/⌘ + Enter 发送</span>
              <Button
                size="3"
                disabled={busy === "run" || !composer.trim()}
                onClick={() => runInstruction(composer)}
              >
                {busy === "run" ? <LoopIcon className="spin" /> : <PaperPlaneIcon />}
                开始核查
              </Button>
            </div>
          </div>

          {error && (
            <div className="workspace-error" role="alert">
              <ExclamationTriangleIcon /> {error}
            </div>
          )}
        </div>

        {/* RIGHT: context + business objects */}
        <aside className="context-pane">
          <SourcePanel
            dataset={dataset}
            busy={busy === "source"}
            onDemo={connectDemo}
            onUpload={uploadFile}
            fileInputRef={fileInputRef}
          />
          <BusinessObjectsPanel
            mappings={mappings}
            repairs={repairs}
            groups={groups}
            tasks={tasks}
            drafts={drafts}
            policy={policy}
            openDrifts={openDrifts}
            needsUser={needsUser}
            latestRunId={latestRunId}
            running={isRunning}
            activeTab={activeTab}
            onTab={setActiveTab}
            objectCounts={objectCounts}
            policyMsg={policyMsg}
            policyBusy={policyBusy}
            onDecideTask={decideTask}
            onDecideRule={decideRule}
            onMineRules={mineRules}
            onSyncPolicy={syncPolicy}
            onDemoPolicyUpdate={demoPolicyUpdate}
            onConfirmArtifact={confirmArtifact}
          />
        </aside>
      </section>
    </main>
  );
}

function SourcePanel({
  dataset,
  busy,
  onDemo,
  onUpload,
  fileInputRef,
}: {
  dataset: UploadedDataset | null;
  busy: boolean;
  onDemo: (sourceId: string) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="workspace-panel source-panel">
      <div className="panel-head tight">
        <strong>本次核查数据</strong>
        {dataset ? (
          <Badge color="green" variant="soft" radius="full">
            <CheckCircledIcon style={{ marginRight: 4 }} /> 已接入
          </Badge>
        ) : (
          <Badge color="gray" variant="soft" radius="full">待接入</Badge>
        )}
      </div>
      <label className="upload-zone" htmlFor="workspace-upload">
        <FileTextIcon />
        <span>上传机构执行价表</span>
        <small>当前演示支持 CSV 表格；电子表格入口已预留。</small>
      </label>
      <a
        className="sample-csv-link mono"
        href="/samples/settlement-sample.csv"
        download="医保结算明细-官方表头样例.csv"
        data-sample-csv
        title="官方结算表口径表头（含剂型/规格/结算数量等非治理列），可直接回传演示字段映射与零售比价。"
      >
        ↓ 官方结算表表头样例（含零售无编码 / 1.3 倍比价行）
      </a>
      <input
        ref={fileInputRef}
        id="workspace-upload"
        data-upload-input
        type="file"
        accept=".csv,.xlsx"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onUpload(file);
        }}
      />
      <div className="source-card-grid">
        {DEMO_SOURCES.map((source) => (
          <button
            key={source.id}
            className="source-card"
            type="button"
            data-source-card
            disabled={busy}
            onClick={() => onDemo(source.id)}
          >
            <Link2Icon />
            <strong>{source.label}</strong>
            <span>{source.description}</span>
          </button>
        ))}
      </div>
      {dataset && (
        <div className="dataset-chip">
          <CheckCircledIcon />
          <span className="mono">
            {dataset.row_count} 行 · {safeArray(dataset.columns_json).slice(0, 3).join("、")}
          </span>
        </div>
      )}
    </section>
  );
}

function BusinessObjectsPanel({
  mappings,
  repairs,
  groups,
  tasks,
  drafts,
  policy,
  openDrifts,
  needsUser,
  latestRunId,
  running,
  activeTab,
  onTab,
  objectCounts,
  policyMsg,
  policyBusy,
  onDecideTask,
  onDecideRule,
  onMineRules,
  onSyncPolicy,
  onDemoPolicyUpdate,
  onConfirmArtifact,
}: {
  mappings: FieldMapping[];
  repairs: RepairPatch[];
  groups: MatchGroup[];
  tasks: WorkspaceSnapshot["workflowTasks"];
  drafts: WorkspaceSnapshot["institutionDrafts"];
  policy: PolicyData;
  openDrifts: DriftRow[];
  needsUser: boolean;
  latestRunId: string | null;
  running: boolean;
  activeTab: ObjectTabKey;
  onTab: (k: ObjectTabKey) => void;
  objectCounts: Record<ObjectTabKey, number>;
  policyMsg: string;
  policyBusy: boolean;
  onDecideTask: (taskId: string, decision: "approve" | "reject", finalAction: string) => Promise<void>;
  onDecideRule: (id: string, decision: "approve" | "reject" | "suspend" | "resume") => Promise<void>;
  onMineRules: () => Promise<void>;
  onSyncPolicy: () => Promise<void>;
  onDemoPolicyUpdate: () => Promise<void>;
  onConfirmArtifact: (artifactId: string, itemCode: string, collectivePrice: number | null) => Promise<void>;
}) {
  void running;
  void openDrifts;
  return (
    <section className="workspace-panel generated-panel" data-generated-object>
      <div className="panel-head tight">
        <strong>核查结果与待办</strong>
        <span className="mono run-id">{latestRunId ? `核查记录 ${latestRunId.slice(0, 10)}` : "等待核查"}</span>
      </div>

      {needsUser && (
        <div className="needs-user" data-needs-user>
          <ExclamationTriangleIcon />
          <div>
            <strong>需要确认</strong>
            <span>
              {tasks.find((t) => t.status.includes("确认"))?.detail || "有字段或单位口径需要人工确认。"}
            </span>
          </div>
        </div>
      )}

      <div className="object-tabs" role="tablist">
        {OBJECT_TABS.map((tab) => {
          const count = objectCounts[tab.key];
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`object-tab${active ? " active" : ""}${count === 0 ? " empty" : ""}`}
              onClick={() => onTab(tab.key)}
            >
              <span className="object-tab-label">{tab.label}</span>
              <span className="object-tab-count mono">{count}</span>
            </button>
          );
        })}
      </div>

      {policyMsg && <div className="policy-sync-msg" data-policy-msg>{policyMsg}</div>}

      <div className="object-tab-body">
        {activeTab === "drift" && <DriftQueueTab drifts={policy.drifts} />}
        {activeTab === "task" && (
          <TaskReviewTab tasks={tasks} busy={policyBusy} onDecide={onDecideTask} />
        )}
        {activeTab === "draft" && (
          <div className="object-list" data-draft-preview>
            {drafts.length === 0 ? (
              <ObjectEmpty />
            ) : (
              drafts.slice(0, 8).map((draft) => (
                <div key={draft.id} className="draft-row">
                  <strong>
                    {draft.target_name} · {draft.draft_type}
                  </strong>
                  <span>{draft.content}</span>
                </div>
              ))
            )}
          </div>
        )}
        {activeTab === "rule" && (
          <RuleCandidatesTab
            rules={policy.rules}
            busy={policyBusy}
            onDecide={onDecideRule}
            onMine={onMineRules}
          />
        )}
        {activeTab === "fact" && (
          <PolicyFactsTab
            facts={policy.facts}
            artifacts={policy.artifacts}
            ingestion={policy.latestIngestion}
            busy={policyBusy}
            onSync={onSyncPolicy}
            onDemoUpdate={onDemoPolicyUpdate}
            onConfirm={onConfirmArtifact}
          />
        )}
        {activeTab === "repair" && (
          <RepairEvidenceTab mappings={mappings} repairs={repairs} groups={groups} />
        )}
      </div>

      <AuditStrip decisions={policy.decisions} />
    </section>
  );
}

// ===== 漂移队列：政策事实变化后不再合规的存量执行价 =====
function DriftQueueTab({ drifts }: { drifts: DriftRow[] }) {
  if (drifts.length === 0) {
    return (
      <div className="object-empty" data-drift-queue>
        <ReaderIcon />
        <span>暂未发现因政策变化产生的执行价风险。可在「政策依据」里演示一次政策变更后再复核。</span>
      </div>
    );
  }
  return (
    <div className="object-list" data-drift-queue>
      {drifts.slice(0, 14).map((d) => {
        const baseline = safeJson(d.baseline_json);
        const observed = safeJson(d.observed_json);
        const baselineVal =
          baseline.collective_price ?? baseline.ceiling_price ?? baseline.reference_price ?? "—";
        const observedVal = observed.observed_max ?? observed.item_code ?? "—";
        return (
          <div key={d.id} className={`drift-row sev-${d.severity}`} data-drift-row>
            <div className="drift-row-head">
              <span className="drift-code mono">{d.item_code}</span>
              <span className="drift-type">{d.rule_key}</span>
              <span className={`drift-sev ${d.severity}`}>{d.severity}</span>
              <span className={`drift-status mono ${d.status}`}>{d.status}</span>
            </div>
            <div className="drift-row-detail mono">
              政策价 {String(baselineVal)} → 观察价 {String(observedVal)}
              {typeof observed.over_pct === "number" ? `（超 ${(observed.over_pct * 100).toFixed(1)}%）` : ""}
              {typeof baseline.source_hash === "string" ? ` · 依据#${String(baseline.source_hash).slice(0, 8)}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== 人审任务：批准（选 final_action）/ 驳回；人审反馈是规则挖掘的数据源 =====
const DECIDED_TASK_STATUSES = new Set(["已人审确认", "已驳回", "自动处置"]);

function defaultActionFor(taskType: string): string {
  if (taskType.includes("集采")) return "集采催办";
  if (taskType.includes("数据治理")) return "转数据治理";
  if (taskType.includes("漂移")) return "集采催办";
  return "机构核实";
}

function TaskReviewTab({
  tasks,
  busy,
  onDecide,
}: {
  tasks: WorkspaceSnapshot["workflowTasks"];
  busy: boolean;
  onDecide: (taskId: string, decision: "approve" | "reject", finalAction: string) => Promise<void>;
}) {
  const [actionById, setActionById] = useState<Record<string, string>>({});
  if (tasks.length === 0) return <ObjectEmpty />;
  return (
    <div className="object-list" data-workflow-task>
      {tasks.slice(0, 24).map((task) => {
        const decided = DECIDED_TASK_STATUSES.has(task.status);
        const action = actionById[task.id] ?? defaultActionFor(task.task_type);
        return (
          <div key={task.id} className="object-row task-row" data-task-row data-task-id={task.id} data-task-status={task.status}>
            <strong>
              {task.task_type} · {task.priority}
              <span className={`task-status-chip mono s-${task.status}`}>{task.status}</span>
            </strong>
            <span>
              {task.title}：{task.detail}
            </span>
            {decided ? (
              task.final_action ? (
                <span className="task-final mono">
                  <CheckCircledIcon /> 处置动作：{task.final_action}（已写入决策日志）
                </span>
              ) : null
            ) : (
              <div className="task-decide" data-task-decide>
                <select
                  className="task-action-select mono"
                  value={action}
                  disabled={busy}
                  onChange={(e) => setActionById((m) => ({ ...m, [task.id]: e.target.value }))}
                >
                  {FINAL_ACTIONS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <button className="mini-btn approve" disabled={busy} onClick={() => onDecide(task.id, "approve", action)}>
                  批准处置
                </button>
                <button className="mini-btn reject" disabled={busy} onClick={() => onDecide(task.id, "reject", action)}>
                  驳回
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ===== 规则候选：来源可审计（source_decision_ids）+ 激活前 dry-run 影响面 =====
function RuleCandidatesTab({
  rules,
  busy,
  onDecide,
  onMine,
}: {
  rules: RuleRow[];
  busy: boolean;
  onDecide: (id: string, decision: "approve" | "reject" | "suspend" | "resume") => Promise<void>;
  onMine: () => Promise<void>;
}) {
  const [dryRunById, setDryRunById] = useState<Record<string, { matched: number; guardrailBlocked: number; autoApplicable: number }>>({});
  const pending = rules.filter((r) => r.status === "pending_review");
  const active = rules.filter((r) => r.status === "active");
  const suspended = rules.filter((r) => r.status === "suspended");

  async function loadDryRun(id: string) {
    try {
      const res = await fetch(`/api/workspace/rule-candidates/${id}/dry-run`);
      const j = await res.json();
      if (j.ok) {
        setDryRunById((m) => ({ ...m, [id]: { matched: j.matched, guardrailBlocked: j.guardrailBlocked, autoApplicable: j.autoApplicable } }));
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="object-list" data-rule-candidates>
      <div className="tab-actions">
        <button className="mini-btn" onClick={onMine} disabled={busy} title="从已确认的人审结论中整理可复用规则，仍需人工激活">
          从人审结论整理规则
        </button>
      </div>

      <div className="policy-section-title">
        <LightningBoltIcon /> 待审候选（{pending.length}）
      </div>
      {pending.length === 0 ? (
        <div className="policy-empty">暂无待审规则。人工确认几条同类处置后，点上方整理。</div>
      ) : (
        pending.slice(0, 5).map((r) => {
          const trigger = safeJson(r.trigger_json);
          const action = safeJson(r.proposed_action_json);
          const srcCount = safeArrayJson(r.source_decision_ids_json).length;
          const dry = dryRunById[r.id];
          return (
            <div key={r.id} className="rule-candidate-item" data-rule-candidate>
              <div className="rc-trigger mono">
                条件：问题={String(trigger.issue_type ?? "?")} · 严重度={String(trigger.severity ?? "?")}
              </div>
              <div className="rc-action mono">
                自动处置为「{String(action.task_type ?? "?")}」→ {String(action.owner_role ?? "?")} · {String(action.priority ?? "?")}
              </div>
              <div className="rc-meta">
                可信度 {(r.confidence * 100).toFixed(0)}% · 同类样本 {r.support_count} ·{" "}
                <span className="rc-src" title="来源人审决策可逐条追溯">
                  来源 {srcCount} 条人工确认
                </span>
                {r.provenance_run_id ? <span className="mono"> · {r.provenance_run_id.slice(0, 14)}</span> : null}
              </div>
              {dry && (
                <div className="rc-dryrun mono" data-rule-dryrun>
                  影响面：命中 {dry.matched} 条历史记录 · 敏感项挡回 {dry.guardrailBlocked} · 可自动 {dry.autoApplicable}
                </div>
              )}
              <div className="rc-actions">
                {!dry && (
                  <button className="mini-btn" onClick={() => loadDryRun(r.id)} disabled={busy}>
                    影响面预览
                  </button>
                )}
                <button className="mini-btn approve" onClick={() => onDecide(r.id, "approve")} disabled={busy}>
                  激活
                </button>
                <button className="mini-btn reject" onClick={() => onDecide(r.id, "reject")} disabled={busy}>
                  拒绝
                </button>
              </div>
            </div>
          );
        })
      )}

      {active.length > 0 && (
        <>
          <div className="policy-section-title">
            <CheckCircledIcon /> 已生效规则（{active.length}）· 下批自动复用 · 随时可停用
          </div>
          {active.slice(0, 4).map((r) => {
            const trigger = safeJson(r.trigger_json);
            const action = safeJson(r.proposed_action_json);
            return (
              <div key={r.id} className="active-rule-item" data-active-rule>
                <span className="mono">
                  {String(trigger.issue_type ?? "?")}/{String(trigger.severity ?? "?")} → {String(action.task_type ?? "?")}
                </span>
                <span className="hit-count">命中 {r.hit_count} 次</span>
                <button
                  className="mini-btn reject"
                  disabled={busy}
                  data-rule-suspend
                  title="可回滚：停用后下批同类项立即回到人工确认，动作会留痕"
                  onClick={() => onDecide(r.id, "suspend")}
                >
                  停用
                </button>
              </div>
            );
          })}
        </>
      )}

      {suspended.length > 0 && (
        <>
          <div className="policy-section-title">
            <ExclamationTriangleIcon /> 已停用规则（{suspended.length}）· 同类项已回到人工确认
          </div>
          {suspended.slice(0, 4).map((r) => {
            const trigger = safeJson(r.trigger_json);
            const action = safeJson(r.proposed_action_json);
            return (
              <div key={r.id} className="active-rule-item suspended" data-suspended-rule>
                <span className="mono">
                  {String(trigger.issue_type ?? "?")}/{String(trigger.severity ?? "?")} → {String(action.task_type ?? "?")}
                </span>
                <span className="hit-count">曾命中 {r.hit_count} 次</span>
                <button
                  className="mini-btn approve"
                  disabled={busy}
                  data-rule-resume
                  title="再次人工确认后恢复自动处置"
                  onClick={() => onDecide(r.id, "resume")}
                >
                  恢复
                </button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ===== 政策事实：baseline 真相源（版本 hash 可追溯）+ 公告 artifact 人审确认 =====
function PolicyFactsTab({
  facts,
  artifacts,
  ingestion,
  busy,
  onSync,
  onDemoUpdate,
  onConfirm,
}: {
  facts: FactRow[];
  artifacts: ArtifactRow[];
  ingestion: IngestionInfo | null;
  busy: boolean;
  onSync: () => Promise<void>;
  onDemoUpdate: () => Promise<void>;
  onConfirm: (artifactId: string, itemCode: string, collectivePrice: number | null) => Promise<void>;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState("HC-LNS-902");
  const [confirmPrice, setConfirmPrice] = useState("560");
  const fetched = artifacts.filter((a) => a.status === "fetched");

  return (
    <div className="object-list" data-policy-facts>
      <div
        className="policy-source-line"
        data-policy-source
        title="政策采集链路：同步公告 → 留痕保存 → 人审确认 → 生效为政策依据。只取公开公告。"
      >
        <span className={`src-dot ${ingestion?.status === "succeeded" ? "ok" : ""}`} aria-hidden />
        <span className="src-name">国家医保局公告 · 公开来源</span>
        <span className="src-meta mono">
          {ingestion
            ? `上次同步 ${ingestion.finished_at ? ingestion.finished_at.slice(5, 16).replace("T", " ") : "—"} · 解析 ${ingestion.fetched_count} · 新增 ${ingestion.changed_count}`
            : "尚未同步 · 点「同步公开政策」抓取"}
        </span>
      </div>
      <div className="tab-actions">
        <button className="mini-btn" data-policy-sync onClick={onSync} disabled={busy} title="抓取国家医保局公开公告，人工确认后才作为核价依据">
          同步公开政策
        </button>
        <button className="mini-btn demo" data-demo-policy-update onClick={onDemoUpdate} disabled={busy} title="演示：HC-LNS-902 集采中选价 640→560。真实链路需公告人审确认。">
          政策变更演示 640→560
        </button>
      </div>

      {facts.length === 0 ? (
        <ObjectEmpty />
      ) : (
        facts.slice(0, 10).map((f) => (
          <div key={f.id} className="fact-row" data-fact-row data-fact-code={f.item_code}>
            <div className="fact-row-head">
              <span className="mono fact-code">{f.item_code}</span>
              <span className="fact-name">{f.item_name}</span>
            </div>
            <div className="fact-row-prices mono">
              中选 {f.collective_price ?? "—"} · 最高 {f.ceiling_price ?? "—"} · 参考 {f.reference_price ?? "—"}
              {f.source_hash ? <span className="fact-hash" title={`来源留痕编号 ${f.source_hash}`}> · 依据#{f.source_hash.slice(0, 8)}</span> : null}
            </div>
          </div>
        ))
      )}

      <div className="policy-section-title" style={{ marginTop: 8 }}>
        <FileTextIcon /> 待确认公告（{fetched.length}）
      </div>
      {fetched.length === 0 ? (
        <div className="policy-empty">暂无待确认公告。点「同步公开政策」抓取国家医保局公开公告。</div>
      ) : (
        fetched.slice(0, 4).map((a) => (
          <div key={a.id} className="artifact-row" data-artifact-row>
            <div className="artifact-title">{a.title}</div>
            <div className="artifact-meta mono">
              {a.published_at ?? "—"} · 留痕 {a.content_hash.slice(0, 10)} · {a.status}
            </div>
            {confirmingId === a.id ? (
              <div className="artifact-confirm-form" data-artifact-confirm>
                <input
                  className="mono"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  placeholder="项目编码"
                  aria-label="医保项目编码"
                />
                <input
                  className="mono"
                  value={confirmPrice}
                  onChange={(e) => setConfirmPrice(e.target.value)}
                  placeholder="中选价"
                  aria-label="集采中选价"
                />
                <button
                  className="mini-btn approve"
                  data-artifact-confirm-submit
                  disabled={busy || !confirmCode.trim()}
                  onClick={() => {
                    const price = Number(confirmPrice);
                    void onConfirm(a.id, confirmCode.trim(), Number.isFinite(price) ? price : null);
                    setConfirmingId(null);
                  }}
                >
                  确认为核价依据
                </button>
              </div>
            ) : (
              <div className="rc-actions">
                <button className="mini-btn" data-artifact-open-confirm disabled={busy} onClick={() => setConfirmingId(a.id)}>
                  人审确认 → 核价依据
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ===== 数据修复：保留 V1 数据清洗证据（字段映射 / 修复 patch / 同品归并）=====
function RepairEvidenceTab({
  mappings,
  repairs,
  groups,
}: {
  mappings: FieldMapping[];
  repairs: RepairPatch[];
  groups: MatchGroup[];
}) {
  const total = mappings.length + repairs.length + groups.length;
  if (total === 0) return <ObjectEmpty />;
  return (
    <div className="object-list" data-repair-evidence>
      <div className="policy-section-title">字段映射（{mappings.length}）</div>
      <div className="mapping-list" data-field-mapping>
        {mappings.slice(0, 8).map((m) => (
          <div key={m.id}>
            <span>{m.source_column}</span>
            <ArrowRightIcon />
            <strong>{m.target_field || "忽略"}</strong>
            <em className="mono">{m.status}</em>
          </div>
        ))}
      </div>
      <div className="policy-section-title">数据修正（{repairs.length}）</div>
      <div data-repair-patch>
        {repairs.slice(0, 6).map((r) => (
          <div key={r.id} className="object-row">
            <strong className="mono">
              第 {r.row_index + 1} 行 · {r.field}
            </strong>
            <span className="mono">
              {r.before_value || "空"} → {r.after_value || "待确认"}
            </span>
          </div>
        ))}
      </div>
      <div className="policy-section-title">同品归并（{groups.length}）</div>
      <div data-match-group>
        {groups.slice(0, 6).map((g) => (
          <div key={g.id} className="object-row">
            <strong>{g.item_name}</strong>
            <span className="mono">
              {safeArray(g.row_indexes_json).length} 行 · {g.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== 治理效能条：自动分流率 / 规则命中 / 漂移闭环 / 节省人时（全部实时可对账）=====
function GovernanceMetricsStrip({ metrics }: { metrics: GovernanceMetrics }) {
  const routed = metrics.autoApproved + metrics.needsHuman;
  const kpis: { key: string; label: string; value: string; hint: string }[] = [
    {
      key: "auto-rate",
      label: "自动分流率",
      value: routed > 0 ? `${(metrics.autoRate * 100).toFixed(0)}%` : "—",
      hint: `自动处置 ${metrics.autoApproved} / 系统分流 ${routed}；由已生效规则和人工边界共同决定`,
    },
    {
      key: "rules",
      label: "激活规则",
      value: `${metrics.activeRules}`,
      hint: `待审 ${metrics.pendingRules} · 已停用 ${metrics.suspendedRules} · 规则累计命中 ${metrics.ruleHits} 次`,
    },
    {
      key: "drift",
      label: "漂移闭环",
      value: `${metrics.driftsResolved}/${metrics.driftsDetected}`,
      hint: `检出 ${metrics.driftsDetected} 条政策变化风险，已复核闭环 ${metrics.driftsResolved} 条，在办 ${metrics.driftsOpen} 条`,
    },
    {
      key: "human",
      label: "人审决策",
      value: `${metrics.humanApproved + metrics.humanRejected}`,
      hint: `批准 ${metrics.humanApproved} · 驳回 ${metrics.humanRejected}；每条都可沉淀为同类处置经验`,
    },
    {
      key: "saved",
      label: "估算节省",
      value: metrics.estimatedMinutesSaved > 0 ? `${metrics.estimatedMinutesSaved} 分钟` : "—",
      hint: metrics.savingAssumption,
    },
  ];
  return (
    <section className="metrics-strip" data-metrics-strip aria-label="治理效能指标">
      {kpis.map((k) => (
        <div key={k.key} className="metric-cell" data-metric={k.key} title={k.hint}>
          <span className="metric-value mono">{k.value}</span>
          <span className="metric-label">{k.label}</span>
        </div>
      ))}
      <div className="metric-cell metric-note mono" title="指标全部按本次留痕实时计算，可与决策记录逐条对账">
        实时 · 可对账
      </div>
    </section>
  );
}

// ===== 审计日志条：自动 + 人审全留痕（approval_decision_log）=====
function AuditStrip({ decisions }: { decisions: DecisionRow[] }) {
  if (decisions.length === 0) return null;
  return (
    <div className="audit-strip" data-audit-strip>
      <div className="audit-strip-title mono">决策留痕</div>
      {decisions.slice(0, 5).map((d) => (
        <div key={d.id} className="audit-row mono" data-audit-row>
          <span className={`audit-decision ${d.decision}`}>{d.decision}</span>
          <span className="audit-target">{d.target_type}:{d.target_id.slice(0, 14)}</span>
          <span className="audit-actor">{d.actor_type}{d.actor_id ? `·${d.actor_id}` : ""}</span>
          <span className="audit-time">{d.created_at.slice(11, 19)}</span>
        </div>
      ))}
    </div>
  );
}

function ObjectEmpty() {
  return (
    <div className="object-empty">
      <ReaderIcon />
      <span>这一类暂时没有结果。核查完成后，系统会自动切到最需要处理的内容。</span>
    </div>
  );
}

function PetSyncStrip({
  isRunning,
  needsUser,
  lastRunStatus,
  objectCounts,
  activeTab,
}: {
  isRunning: boolean;
  needsUser: boolean;
  lastRunStatus: "success" | "degraded" | "failed" | null;
  objectCounts: Record<ObjectTabKey, number>;
  activeTab: ObjectTabKey;
}) {
  const totalObjects =
    objectCounts.drift + objectCounts.task + objectCounts.draft + objectCounts.rule + objectCounts.repair;
  const activeLabel = OBJECT_TABS.find((tab) => tab.key === activeTab)?.label ?? "结果";
  const state: PetSyncState = isRunning
    ? "running"
    : needsUser
      ? "needs"
      : lastRunStatus === "failed"
        ? "failed"
        : lastRunStatus === "degraded"
          ? "degraded"
          : totalObjects > 0
            ? "ready"
            : "idle";
  const copy: Record<PetSyncState, { title: string; detail: string }> = {
    running: {
      title: "小序正在跟着核查",
      detail: "对话区显示核查步骤；点右下角小序，会把对话滚到最新进度。",
    },
    needs: {
      title: "小序在等你确认",
      detail: `当前重点是「${activeLabel}」。右侧有待确认项，点小序会带你看处理对象。`,
    },
    failed: {
      title: "小序发现核查异常",
      detail: "可确定的结果会保留，不能确定的不会伪造成成功结论。",
    },
    degraded: {
      title: "小序保留了可确定结果",
      detail: "智能研判异常时，字段、归并、规则判断等可确定结果仍可查看。",
    },
    ready: {
      title: "小序已同步结果",
      detail: `已形成 ${totalObjects} 个核查对象，右侧会停在最需要处理的栏目。`,
    },
    idle: {
      title: "小序会跟随本次核查",
      detail: "开始核查后，它会根据核查、待确认和结果状态提示你下一步。",
    },
  };
  return (
    <div className={`pet-sync-strip ${state}`} data-pet-sync-strip>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/xiaoxu.png" alt="" aria-hidden />
      <div>
        <strong>{copy[state].title}</strong>
        <span>{copy[state].detail}</span>
      </div>
    </div>
  );
}

// V2 阶段定义：固定顺序，像 coding agent 一样逐步展示。
// 标注哪些阶段解决"政策对齐/规则负担/漂移"痛点，让评委一眼看到新能力。
const AGENT_STAGES: { phase: string; label: string; icon: "read" | "plan" | "tools" | "write" | "verify" | "drift" | "learn"; painPoint?: string }[] = [
  { phase: "observe", label: "读取本批数据", icon: "read" },
  { phase: "plan", label: "判断先核哪些问题", icon: "plan" },
  { phase: "tools", label: "核字段、单位和同品归并", icon: "tools" },
  { phase: "mutate", label: "生成待办和处置口径", icon: "write" },
  { phase: "verify", label: "对照最新政策找漂移", icon: "drift", painPoint: "政策跟不住" },
  { phase: "learn", label: "整理可复用的人审规则", icon: "learn", painPoint: "规则负担重" },
  { phase: "verify-replay", label: "保存留痕，便于复查", icon: "verify" },
];

function StageIcon({ name, running }: { name: string; running?: boolean }) {
  if (running) return <LoopIcon className="spin" />;
  switch (name) {
    case "read": return <ReaderIcon />;
    case "plan": return <LightningBoltIcon />;
    case "tools": return <LoopIcon />;
    case "write": return <FileTextIcon />;
    case "drift": return <ExclamationTriangleIcon />;
    case "learn": return <LightningBoltIcon />;
    default: return <CheckCircledIcon />;
  }
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const roleLabel =
    message.role === "user" ? "你" : message.role === "system" ? "系统" : "价序";
  return (
    <article className={`message-bubble ${message.role}`}>
      <div className="message-role">
        {message.role === "assistant" && (
          <img
            className="agent-mark-img inline"
            src="/brand/logomark.svg"
            alt=""
            aria-hidden
          />
        )}
        {roleLabel}
      </div>
      <div className="message-content">
        {message.content.split("\n").map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </article>
  );
}

function latestOnly<T extends { run_id: string }>(items: T[], runId: string | null): T[] {
  if (!runId) return [];
  return items.filter((item) => item.run_id === runId);
}

function safeArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeArrayJson(json: string | null): string[] {
  if (!json) return [];
  return safeArray(json);
}

function safeJson(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// V2: agent 执行步骤作为对话消息流式显示（像 coding agent 逐步输出）。
// 不是旁边的小 timeline 窗口，而是直接在对话框里作为 assistant 消息。
function AgentStepsMessage({ events, running }: { events: RunEvent[]; running: boolean }) {
  // run 进行中还没有落库事件：按真实执行节奏做一个诚实的进度示意
  // （读取上下文很快完成，之后长时间停在"生成处理计划"= 真实模型 provider 调用）。
  const synthetic = running && events.length === 0;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!synthetic) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 400);
    return () => clearInterval(id);
  }, [synthetic]);

  // 按 phase 映射到固定阶段顺序
  const eventByPhase = new Map<string, RunEvent>();
  for (const e of events) {
    const isDrift = e.title.includes("漂移");
    const isReplay = e.title.includes("可复查") || e.title.includes("回放");
    const key = isDrift ? "verify-drift" : isReplay ? "verify-replay" : e.phase;
    if (!eventByPhase.has(key)) eventByPhase.set(key, e);
  }
  const completedKeys = new Set(eventByPhase.keys());
  const currentStageIdx = running
    ? synthetic
      ? elapsed >= 1.2
        ? 1
        : 0
      : AGENT_STAGES.findIndex((s) => {
        const k = s.phase === "verify" ? "verify-drift" : s.phase;
        return !completedKeys.has(k);
      })
    : -1;

  return (
    <article className="message-bubble assistant agent-steps-message" data-agent-steps>
      <div className="message-role">
        <LightningBoltIcon /> 价序正在核查
      </div>
      <div className="message-body">
        <div className="agent-steps-list">
          {AGENT_STAGES.map((stage, idx) => {
            const key = stage.phase === "verify" ? "verify-drift" : stage.phase;
            const event = eventByPhase.get(key);
            const isDone = Boolean(event) || (synthetic && idx < currentStageIdx);
            const isActive = running && idx === currentStageIdx;
            const isPending = running && idx > currentStageIdx;
            const cls = `agent-step-row${isActive ? " active" : ""}${isDone ? " done" : ""}${isPending ? " pending" : ""}`;
            return (
              <div key={stage.phase} className={cls}>
                <span className="agent-step-num mono">{String(idx + 1).padStart(2, "0")}</span>
                <span className="agent-step-icon">
                  <StageIcon name={stage.icon} running={isActive} />
                </span>
                <div className="agent-step-text">
                  <div className="agent-step-head">
                    <span className="agent-step-label">{stage.label}</span>
                    {stage.painPoint && (
                      <span className="agent-step-pain" title={`解决痛点：${stage.painPoint}`}>{stage.painPoint}</span>
                    )}
                    {isDone && <span className="agent-step-state done">已完成</span>}
                    {isActive && <span className="agent-step-state running">进行中</span>}
                    {isPending && <span className="agent-step-state">等待</span>}
                  </div>
                  {synthetic && isActive && stage.phase === "plan" && (
                    <div className="agent-step-detail">正在结合本批数据生成处理计划…</div>
                  )}
                  {event && (
                    <div className="agent-step-detail">{event.detail}
                      {stage.phase === "learn" && event.event_json && (
                        <span className="agent-step-extra">（{(() => { try { const j = JSON.parse(event.event_json); return `自动 ${j.autoApproved ?? 0} · 人审 ${j.escalatedToHuman ?? 0}`; } catch { return ""; } })()}）</span>
                      )}
                      {stage.phase === "verify" && event.title.includes("漂移") && event.event_json && (
                        <span className="agent-step-extra drift">（{(() => { try { const j = JSON.parse(event.event_json); return `检出 ${j.detected ?? 0} 条漂移 · 建 ${j.tasksCreated ?? 0} 个复核任务`; } catch { return ""; } })()}）</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
