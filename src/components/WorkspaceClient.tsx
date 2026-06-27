"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

const PROMPTS: { key: string; label: string; text: string }[] = [
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
    key: "match_first",
    label: "把同品同规先归并，拿不准的问我",
    text: "请先把同品同规归并。高置信的直接建组，拿不准的只提出确认问题。",
  },
  {
    key: "parse_replies",
    label: "解析机构回函，更新昨日续办",
    text: "请解析机构回函，提取价格、原因、承诺时间和缺失材料，并更新昨日续办任务。",
  },
  {
    key: "data_governance",
    label: "生成需要发起的数据治理确认",
    text: "请生成需要发起的数据治理确认。缺字段、缺包装单位和编码不稳的项先不要催医院。",
  },
];

const OBJECT_TABS = [
  { key: "mapping", label: "字段映射" },
  { key: "repair", label: "修复 patch" },
  { key: "match", label: "同品归并" },
  { key: "task", label: "流程任务" },
  { key: "draft", label: "机构口径" },
] as const;
type ObjectTabKey = (typeof OBJECT_TABS)[number]["key"];

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
  const [activeTab, setActiveTab] = useState<ObjectTabKey>("mapping");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const dataset = snapshot.dataset;
  const thread = snapshot.thread;
  const latestRunId = snapshot.runEvents.at(-1)?.run_id ?? null;
  const needsUser = thread?.state === "needs_user";
  const messages = useMemo(() => {
    const base = snapshot.messages ?? [];
    if (!runningText) return base;
    const optimistic: ConversationMessage = {
      id: "optimistic-running",
      thread_id: thread?.id ?? "",
      role: "assistant",
      content: runningText,
      meta_json: "{}",
      created_at: new Date().toISOString(),
    };
    return [...base, optimistic];
  }, [runningText, snapshot.messages, thread?.id]);

  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages.length, runningText]);

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
        throw new Error("当前演示先支持 CSV，XLSX 已预留入口。请先转成 CSV 或使用演示数据源。");
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
    setRunningText("我会先检查字段和价格口径，再决定哪些能修、哪些要问你、哪些要进入流程任务。");
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
        snapshot?: WorkspaceSnapshot;
        error_category?: string;
      };
      if (!data.snapshot) throw new Error(data.message || "Agent 没有返回工作台状态。");
      setSnapshot(data.snapshot);
      setComposer("");
      if (!data.ok && data.error_category) {
        setError(`Provider 降级：${data.error_category}。确定性结果已保留。`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent 运行失败。");
    } finally {
      setRunningText("");
      setBusy(null);
    }
  }

  function usePrompt(prompt: (typeof PROMPTS)[number]) {
    setComposer(prompt.text);
    void runInstruction(prompt.text, prompt.key);
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
            setError(data.message || "无法连接演示数据源，请手动选择数据源后再发送 prompt。");
            return;
          }
        } catch {
          setError("无法连接演示数据源，请手动选择数据源后再发送 prompt。");
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

  const objectCounts: Record<ObjectTabKey, number> = {
    mapping: mappings.length,
    repair: repairs.length,
    match: groups.length,
    task: tasks.length,
    draft: drafts.length,
  };
  const totalObjects = Object.values(objectCounts).reduce((a, b) => a + b, 0);

  // Auto-switch to the first non-empty tab when a run finishes.
  useEffect(() => {
    if (isRunning || totalObjects === 0) return;
    if (objectCounts[activeTab] > 0) return;
    const next = OBJECT_TABS.find((t) => objectCounts[t.key] > 0);
    if (next) setActiveTab(next.key);
  }, [isRunning, totalObjects, objectCounts, activeTab]);

  return (
    <main className="workspace-shell" data-workspace data-visual-lane="agent-workbench">
      <section className="workspace-band">
        <div className="workspace-band-left">
          <img className="agent-mark-img" src="/brand/logomark.svg" alt="" aria-hidden />
          <div className="workspace-band-text">
            <div className="workspace-band-title">价序工作台</div>
            <div className="workspace-band-sub mono">
              <span>{thread?.id?.slice(0, 18) ?? "未初始化"}</span>
              <span className="sep" aria-hidden>·</span>
              <span className={`state state-${threadState}`}>{threadState}</span>
              <span className="sep" aria-hidden>·</span>
              <span className="provider">
                <span className={`dot ${providerStatus.configured ? "ok" : "warn"}`} aria-hidden />
                {providerStatus.configured
                  ? `${providerStatus.baseUrlHost} / ${providerStatus.model}`
                  : "provider 未配置"}
              </span>
            </div>
          </div>
        </div>
        <Badge
          color={isRunning ? "blue" : needsUser ? "amber" : dataset ? "green" : "gray"}
          variant="soft"
          radius="full"
          className="workspace-band-badge"
        >
          {isRunning ? (
            <>
              <LoopIcon className="spin" style={{ marginRight: 4 }} /> running
            </>
          ) : needsUser ? (
            "needs user"
          ) : dataset ? (
            <>
              <CheckCircledIcon style={{ marginRight: 4 }} /> context ready
            </>
          ) : (
            "no context"
          )}
        </Badge>
      </section>

      <section className="workspace-prompt-rail" aria-label="内置业务 prompt">
        <span className="rail-label mono" aria-hidden>
          <LightningBoltIcon /> prompts
        </span>
        <div className="rail-chips">
          {PROMPTS.map((prompt) => (
            <button
              key={prompt.key}
              type="button"
              data-prompt-chip
              className="prompt-chip"
              disabled={busy === "run"}
              onClick={() => usePrompt(prompt)}
            >
              {prompt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="workspace-grid">
        {/* LEFT: conversation pane */}
        <div className="conversation-pane">
          <div className="message-list" ref={messageListRef} aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-conversation">
                <ReaderIcon />
                <strong>先接入一批价格上下文</strong>
                <span>上传 CSV，或连接右侧演示数据源。接入后用上面的业务 prompt 直接交代任务。</span>
              </div>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
            {isRunning && <ToolRunTimeline events={events} running />}
          </div>

          <div className="composer" data-conversation-composer>
            {dataset && (
              <div className="composer-context">
                <CheckCircledIcon />
                <span>
                  上下文：<strong>{dataset.title}</strong>
                  <span className="mono" style={{ marginLeft: 8, color: "var(--ink-3)" }}>
                    {dataset.row_count} 行
                  </span>
                </span>
              </div>
            )}
            <TextArea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="上传表格或连接数据源，然后说你要完成什么……"
              size="3"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void runInstruction(composer);
                }
              }}
            />
            <div className="composer-actions">
              <span className="mono">⌘ + Enter 发送</span>
              <Button
                size="3"
                disabled={busy === "run" || !composer.trim()}
                onClick={() => runInstruction(composer)}
              >
                {busy === "run" ? <LoopIcon className="spin" /> : <PaperPlaneIcon />}
                发给价序
              </Button>
            </div>
          </div>

          {error && (
            <div className="workspace-error" role="alert">
              <ExclamationTriangleIcon /> {error}
            </div>
          )}
        </div>

        {/* RIGHT: context + generated objects */}
        <aside className="context-pane">
          <SourcePanel
            dataset={dataset}
            busy={busy === "source"}
            onDemo={connectDemo}
            onUpload={uploadFile}
            fileInputRef={fileInputRef}
          />
          <GeneratedObjectsPanel
            mappings={mappings}
            repairs={repairs}
            groups={groups}
            tasks={tasks}
            drafts={drafts}
            events={events}
            needsUser={needsUser}
            latestRunId={latestRunId}
            running={isRunning}
            activeTab={activeTab}
            onTab={setActiveTab}
            objectCounts={objectCounts}
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
        <strong>数据上下文</strong>
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
        <span>上传 CSV / XLSX</span>
        <small>当前演示先支持 CSV，XLSX 已预留入口。</small>
      </label>
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

function GeneratedObjectsPanel({
  mappings,
  repairs,
  groups,
  tasks,
  drafts,
  events,
  needsUser,
  latestRunId,
  running,
  activeTab,
  onTab,
  objectCounts,
}: {
  mappings: FieldMapping[];
  repairs: RepairPatch[];
  groups: MatchGroup[];
  tasks: WorkspaceSnapshot["workflowTasks"];
  drafts: WorkspaceSnapshot["institutionDrafts"];
  events: RunEvent[];
  needsUser: boolean;
  latestRunId: string | null;
  running: boolean;
  activeTab: ObjectTabKey;
  onTab: (k: ObjectTabKey) => void;
  objectCounts: Record<ObjectTabKey, number>;
}) {
  return (
    <section className="workspace-panel generated-panel" data-generated-object>
      <div className="panel-head tight">
        <strong>已生成对象</strong>
        <span className="mono run-id">{latestRunId ? latestRunId.slice(0, 18) : "等待任务"}</span>
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

      <ToolRunTimeline events={events} running={running} compact />

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

      <div className="object-tab-body">
        {activeTab === "mapping" && (
          <div className="mapping-list" data-field-mapping>
            {mappings.length === 0 ? (
              <ObjectEmpty />
            ) : (
              mappings.slice(0, 12).map((m) => (
                <div key={m.id}>
                  <span>{m.source_column}</span>
                  <ArrowRightIcon />
                  <strong>{m.target_field || "忽略"}</strong>
                  <em className="mono">{m.status}</em>
                </div>
              ))
            )}
          </div>
        )}
        {activeTab === "repair" && (
          <div className="object-list" data-repair-patch>
            {repairs.length === 0 ? (
              <ObjectEmpty />
            ) : (
              repairs.slice(0, 12).map((r) => (
                <div key={r.id} className="object-row">
                  <strong className="mono">
                    第 {r.row_index + 1} 行 · {r.field}
                  </strong>
                  <span className="mono">
                    {r.before_value || "空"} → {r.after_value || "待确认"}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {activeTab === "match" && (
          <div className="object-list" data-match-group>
            {groups.length === 0 ? (
              <ObjectEmpty />
            ) : (
              groups.slice(0, 12).map((g) => (
                <div key={g.id} className="object-row">
                  <strong>{g.item_name}</strong>
                  <span className="mono">
                    {safeArray(g.row_indexes_json).length} 行 · {g.status}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {activeTab === "task" && (
          <div className="object-list" data-workflow-task>
            {tasks.length === 0 ? (
              <ObjectEmpty />
            ) : (
              tasks.slice(0, 12).map((task) => (
                <div key={task.id} className="object-row">
                  <strong>
                    {task.task_type} · {task.priority}
                  </strong>
                  <span>
                    {task.title}：{task.detail}
                  </span>
                </div>
              ))
            )}
          </div>
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
      </div>
    </section>
  );
}

function ObjectEmpty() {
  return (
    <div className="object-empty">
      <ReaderIcon />
      <span>这一类还没有对象，等 agent 跑完会自动切到第一个有内容的 tab。</span>
    </div>
  );
}

function ToolRunTimeline({
  events,
  running = false,
  compact = false,
}: {
  events: RunEvent[];
  running?: boolean;
  compact?: boolean;
}) {
  const shown = compact ? events.slice(-4) : events.slice(-6);
  return (
    <div className="tool-timeline" data-tool-run data-agent-plan={running ? "running" : "ready"}>
      {running && (
        <div className="tool-step active">
          <LoopIcon className="spin" />
          <span className="step-label">正在规划字段修复、价格分析和流程任务</span>
          <span className="step-meta mono">running</span>
        </div>
      )}
      {shown.map((event) => (
        <div key={event.id} className="tool-step">
          {event.ok ? <CheckCircledIcon /> : <ExclamationTriangleIcon />}
          <span className="step-label">{event.title}</span>
          <span className="step-meta mono">{event.phase}</span>
        </div>
      ))}
      {!running && shown.length === 0 && (
        <div className="tool-step" style={{ opacity: 0.55 }}>
          <ReaderIcon />
          <span className="step-label">还没有 agent 执行步骤</span>
        </div>
      )}
    </div>
  );
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
