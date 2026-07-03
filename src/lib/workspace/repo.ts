import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { getRows, listReleases } from "../repo";
import type {
  AgentInstruction,
  ConversationMessage,
  ConversationThread,
  DataSourceConnection,
  DispositionItem,
  FieldMapping,
  InstitutionDraft,
  MatchGroup,
  PriceBasisPack,
  RepairPatch,
  RuleEvaluation,
  RunEvent,
  UnitConversion,
  UploadedDataset,
  WorkflowTask,
  WorkspaceSnapshot,
  WorkspaceThreadState,
} from "../types";
import type { WorkspaceRawRow } from "./csv";
import { DEMO_SOURCES, type DemoSourceId } from "./demoSources";

type Params = Record<string, unknown>;

function db(): ReturnType<typeof getDb> {
  return getDb();
}

function all<T>(sql: string, params?: Params): T[] {
  const stmt = db().prepare(sql);
  const rows = (params ? stmt.all(params) : stmt.all()) as unknown[];
  return rows.map((row) => plain(row)) as T[];
}

function one<T>(sql: string, params?: Params): T | null {
  const stmt = db().prepare(sql);
  const row = (params ? stmt.get(params) : stmt.get()) as unknown;
  return row ? (plain(row) as T) : null;
}

function plain(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  return Object.fromEntries(Object.entries(row));
}

function id(prefix: string): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${day}-${randomUUID().slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createWorkspaceFromUpload(input: {
  title: string;
  fileName: string;
  columns: string[];
  rows: WorkspaceRawRow[];
}): WorkspaceSnapshot {
  const created = nowIso();
  const threadId = id("THR");
  const datasetId = id("UDS");
  const title = input.title.trim() || "上传价格表";
  const fileName = input.fileName.trim() || "upload.csv";

  insertThread({
    id: threadId,
    title,
    state: "has_context",
    context_type: "uploaded_dataset",
    context_ref_id: datasetId,
    source_label: fileName,
    last_instruction: null,
    provider_status: null,
    created_at: created,
    updated_at: created,
  });
  insertDataset({
    id: datasetId,
    threadId,
    title,
    fileName,
    sourceType: "csv_upload",
    columns: input.columns,
    rows: input.rows,
    releaseId: null,
    created,
  });
  addMessage(threadId, "assistant", `已接入 ${fileName}，读到 ${input.rows.length} 行。现在可以直接交代价格治理任务。`, {
    dataset_id: datasetId,
    source_type: "csv_upload",
  });

  return getWorkspaceSnapshot(threadId);
}

export function createWorkspaceFromDemoSource(sourceId: DemoSourceId): WorkspaceSnapshot {
  const source = DEMO_SOURCES.find((s) => s.id === sourceId) ?? DEMO_SOURCES[0];
  const releases = listReleases();
  const release =
    releases.find((r) => r.id === source.releaseHint) ??
    releases.find((r) => r.id === "REL-SAMPLE-01") ??
    releases[0];
  if (!release) throw new Error("演示数据尚未初始化。");

  const rows = getRows(release.id).slice(0, source.id === "demo-replies" ? 8 : 18);
  const columns = [
    "医保项目编码",
    "药品/耗材名称",
    "价格日期",
    "采购渠道",
    "地区",
    "机构执行价",
    "包装单位",
    "机构名称",
    ...(source.id === "demo-replies" ? ["机构回函摘要"] : []),
  ];
  const rawRows: WorkspaceRawRow[] = rows.map((r, idx) => {
    const institution =
      idx % 4 === 0 ? "市人民医院" : idx % 4 === 1 ? "省立医院" : idx % 4 === 2 ? "区中心医院" : "基层医疗机构";
    return {
      医保项目编码: r.item_code,
      "药品/耗材名称": r.item_name,
      价格日期: r.price_date,
      采购渠道: r.procurement_channel,
      地区: r.region,
      机构执行价: r.unit_price,
      包装单位: idx % 6 === 0 ? "" : "目录单位",
      机构名称: institution,
      ...(source.id === "demo-replies"
        ? {
            机构回函摘要:
              idx % 2 === 0
                ? "机构说明价格差异来自包装单位填写不一致，承诺今日补截图。"
                : "机构反馈已按中选价执行，但缺少省平台落地截图。",
          }
        : {}),
    };
  });

  const created = nowIso();
  const threadId = id("THR");
  const datasetId = id("UDS");
  const connectionId = id("DSC");

  insertThread({
    id: threadId,
    title: source.label,
    state: "has_context",
    context_type: "data_source_connection",
    context_ref_id: connectionId,
    source_label: source.label,
    last_instruction: null,
    provider_status: null,
    created_at: created,
    updated_at: created,
  });
  insertDataset({
    id: datasetId,
    threadId,
    title: `${source.label} · ${release.title}`,
    fileName: null,
    sourceType: source.sourceKind,
    columns,
    rows: rawRows,
    releaseId: release.id,
    created,
  });
  db()
    .prepare(
      `INSERT INTO data_source_connection
       (id, thread_id, label, source_kind, status, dataset_id, row_count, metadata_json, connected_at)
       VALUES (:id, :thread_id, :label, :source_kind, :status, :dataset_id, :row_count, :metadata_json, :connected_at)`,
    )
    .run({
      id: connectionId,
      thread_id: threadId,
      label: source.label,
      source_kind: source.sourceKind,
      status: "connected",
      dataset_id: datasetId,
      row_count: rawRows.length,
      metadata_json: JSON.stringify({
        demo: true,
        description: source.description,
        release_id: release.id,
        synthetic_notice: "合成/脱敏演示数据，不代表真实医保生产数据。",
      }),
      connected_at: created,
    });
  addMessage(threadId, "assistant", `已连接${source.label}，同步 ${rawRows.length} 行合成/脱敏数据。你可以点内置 prompt，也可以直接说要怎么处理。`, {
    dataset_id: datasetId,
    connection_id: connectionId,
    source_type: source.sourceKind,
  });

  return getWorkspaceSnapshot(threadId);
}

function insertThread(thread: ConversationThread): void {
  db()
    .prepare(
      `INSERT INTO conversation_thread
       (id, title, state, context_type, context_ref_id, source_label, last_instruction, provider_status, created_at, updated_at)
       VALUES (:id, :title, :state, :context_type, :context_ref_id, :source_label, :last_instruction, :provider_status, :created_at, :updated_at)`,
    )
    .run(thread as unknown as Params);
}

function insertDataset(input: {
  id: string;
  threadId: string;
  title: string;
  fileName: string | null;
  sourceType: string;
  columns: string[];
  rows: WorkspaceRawRow[];
  releaseId: string | null;
  created: string;
}) {
  db()
    .prepare(
      `INSERT INTO uploaded_dataset
       (id, thread_id, title, file_name, source_type, row_count, columns_json, rows_json, release_id, synthetic, created_at)
       VALUES (:id, :thread_id, :title, :file_name, :source_type, :row_count, :columns_json, :rows_json, :release_id, 1, :created_at)`,
    )
    .run({
      id: input.id,
      thread_id: input.threadId,
      title: input.title,
      file_name: input.fileName,
      source_type: input.sourceType,
      row_count: input.rows.length,
      columns_json: JSON.stringify(input.columns),
      rows_json: JSON.stringify(input.rows),
      release_id: input.releaseId,
      created_at: input.created,
    });
}

export function addMessage(
  threadId: string,
  role: "user" | "assistant" | "system",
  content: string,
  meta: Record<string, unknown> = {},
): ConversationMessage {
  const created = nowIso();
  const messageId = id("MSG");
  db()
    .prepare(
      `INSERT INTO conversation_message
       (id, thread_id, role, content, meta_json, created_at)
       VALUES (:id, :thread_id, :role, :content, :meta_json, :created_at)`,
    )
    .run({
      id: messageId,
      thread_id: threadId,
      role,
      content,
      meta_json: JSON.stringify(meta),
      created_at: created,
    });
  return one<ConversationMessage>("SELECT * FROM conversation_message WHERE id = :id", {
    id: messageId,
  })!;
}

export function updateWorkspaceThread(
  threadId: string,
  patch: {
    state?: WorkspaceThreadState;
    lastInstruction?: string | null;
    providerStatus?: string | null;
    title?: string;
  },
): void {
  const thread = getWorkspaceThread(threadId);
  if (!thread) return;
  db()
    .prepare(
      `UPDATE conversation_thread
       SET state = :state, last_instruction = :last_instruction, provider_status = :provider_status,
           title = :title, updated_at = :updated_at
       WHERE id = :id`,
    )
    .run({
      id: threadId,
      state: patch.state ?? thread.state,
      last_instruction:
        patch.lastInstruction === undefined ? thread.last_instruction : patch.lastInstruction,
      provider_status:
        patch.providerStatus === undefined ? thread.provider_status : patch.providerStatus,
      title: patch.title ?? thread.title,
      updated_at: nowIso(),
    });
}

export function getWorkspaceThread(threadId: string): ConversationThread | null {
  return one<ConversationThread>("SELECT * FROM conversation_thread WHERE id = :id", {
    id: threadId,
  });
}

export function getWorkspaceDataset(threadId: string): UploadedDataset | null {
  return one<UploadedDataset>(
    `SELECT * FROM uploaded_dataset
     WHERE thread_id = :threadId
     ORDER BY created_at DESC
     LIMIT 1`,
    { threadId },
  );
}

export function parseDatasetRows(dataset: UploadedDataset): WorkspaceRawRow[] {
  try {
    const parsed = JSON.parse(dataset.rows_json) as unknown;
    if (Array.isArray(parsed)) return parsed as WorkspaceRawRow[];
  } catch {
    /* ignore */
  }
  return [];
}

export function parseDatasetColumns(dataset: UploadedDataset): string[] {
  try {
    const parsed = JSON.parse(dataset.columns_json) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* ignore */
  }
  return [];
}

export function getWorkspaceSnapshot(threadId?: string | null): WorkspaceSnapshot {
  const thread = threadId
    ? getWorkspaceThread(threadId)
    : one<ConversationThread>(
        "SELECT * FROM conversation_thread ORDER BY updated_at DESC LIMIT 1",
      );
  const id = thread?.id ?? "";
  const dataset = id ? getWorkspaceDataset(id) : null;
  const connection = id
    ? one<DataSourceConnection>(
        "SELECT * FROM data_source_connection WHERE thread_id = :threadId ORDER BY connected_at DESC LIMIT 1",
        { threadId: id },
      )
    : null;

  return {
    thread,
    dataset,
    connection,
    messages: id
      ? all<ConversationMessage>(
          "SELECT * FROM conversation_message WHERE thread_id = :threadId ORDER BY created_at ASC",
          { threadId: id },
        )
      : [],
    instructions: id
      ? all<AgentInstruction>(
          "SELECT * FROM agent_instruction WHERE thread_id = :threadId ORDER BY created_at ASC",
          { threadId: id },
        )
      : [],
    fieldMappings: id
      ? all<FieldMapping>(
          "SELECT * FROM field_mapping WHERE thread_id = :threadId ORDER BY created_at DESC, source_column ASC",
          { threadId: id },
        )
      : [],
    repairPatches: id
      ? all<RepairPatch>(
          "SELECT * FROM repair_patch WHERE thread_id = :threadId ORDER BY created_at DESC, row_index ASC",
          { threadId: id },
        )
      : [],
    matchGroups: id
      ? all<MatchGroup>(
          "SELECT * FROM match_group WHERE thread_id = :threadId ORDER BY created_at DESC, group_key ASC",
          { threadId: id },
        )
      : [],
    unitConversions: id
      ? all<UnitConversion>(
          "SELECT * FROM unit_conversion WHERE thread_id = :threadId ORDER BY created_at DESC",
          { threadId: id },
        )
      : [],
    priceBasisPacks: id
      ? all<PriceBasisPack>(
          "SELECT * FROM price_basis_pack WHERE thread_id = :threadId ORDER BY created_at DESC",
          { threadId: id },
        )
      : [],
    ruleEvaluations: id
      ? all<RuleEvaluation>(
          "SELECT * FROM rule_evaluation WHERE thread_id = :threadId ORDER BY created_at DESC",
          { threadId: id },
        )
      : [],
    dispositionItems: id
      ? all<DispositionItem>(
          "SELECT * FROM disposition_item WHERE thread_id = :threadId ORDER BY created_at DESC, row_index ASC",
          { threadId: id },
        )
      : [],
    institutionDrafts: id
      ? all<InstitutionDraft>(
          "SELECT * FROM institution_draft WHERE thread_id = :threadId ORDER BY created_at DESC",
          { threadId: id },
        )
      : [],
    workflowTasks: id
      ? all<WorkflowTask>(
          "SELECT * FROM workflow_task WHERE thread_id = :threadId ORDER BY created_at DESC, priority DESC",
          { threadId: id },
        )
      : [],
    runEvents: id
      ? all<RunEvent>(
          "SELECT * FROM run_event WHERE thread_id = :threadId ORDER BY created_at ASC",
          { threadId: id },
        )
      : [],
    recentThreads: all<ConversationThread>(
      "SELECT * FROM conversation_thread ORDER BY updated_at DESC LIMIT 5",
    ),
  };
}

export function workspaceDb(): ReturnType<typeof getDb> {
  return db();
}

export function workspaceId(prefix: string): string {
  return id(prefix);
}

export function workspaceNow(): string {
  return nowIso();
}
