import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "../db";
import { workspaceId, workspaceNow } from "../workspace/repo";
import { parseWorkspaceCsv } from "../workspace/csv";

// ===== 内网政策文件上传（PDF / CSV / XLSX / DOCX）=====
// 医保内网无外网，"同步公开政策"抓不到公告；本模块提供同等链路的本地入口：
// 上传文件 → policy_artifact（hash 留痕、幂等去重）→ 人审确认 → policy_fact 生效。
// CSV 会自动解析出结构化价格事实建议（编码/参考价/最高价/中选价），确认时可一键批量生效；
// PDF/XLSX/DOCX 先留痕，由人工在确认表单录入结构化字段——事实生效必须人审，与外网链路一致。

const UPLOAD_SOURCE_ID = "PS-LOCAL-UPLOAD-001";

export interface SuggestedFact {
  item_code: string;
  item_name?: string;
  reference_price?: number;
  ceiling_price?: number;
  collective_price?: number;
}

export interface PolicyUploadResult {
  ok: boolean;
  message: string;
  artifactId?: string;
  contentHash?: string;
  artifactType?: string;
  suggestedFacts?: SuggestedFact[];
  duplicated?: boolean;
}

const FACT_COLUMN_ALIASES: Record<keyof Omit<SuggestedFact, "item_name">, string[]> & {
  item_name: string[];
} = {
  item_code: ["医保项目编码", "项目编码", "药品编码", "耗材编码", "编码", "item_code", "code"],
  item_name: ["药品/耗材名称", "药品耗材名称", "项目名称", "药品名称", "名称", "item_name", "name"],
  reference_price: ["参考价", "监测参考价", "reference_price"],
  ceiling_price: ["最高有效价", "最高限价", "挂网价上限", "最高挂网价", "ceiling_price"],
  collective_price: ["中选价", "集采中选价", "集采价格", "collective_price"],
};

function extOf(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return m ? m[1].toLowerCase() : "";
}

function artifactTypeOf(fileName: string): "pdf" | "csv" | "xlsx" | "docx" | "html" {
  const ext = extOf(fileName);
  if (ext === "csv") return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "html" || ext === "htm") return "html";
  return "pdf";
}

function columnFor(columns: string[], aliases: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-—/（）()]/g, "");
  for (const alias of aliases) {
    const hit = columns.find((c) => norm(c) === norm(alias));
    if (hit) return hit;
  }
  for (const alias of aliases) {
    const hit = columns.find((c) => norm(c).includes(norm(alias)));
    if (hit) return hit;
  }
  return null;
}

function moneyOf(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(String(value).replace(/[,\s元¥]/g, ""));
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : undefined;
}

// CSV → 结构化政策事实建议（最多 30 条；解析不到编码列则返回空，让人工录入）。
export function suggestFactsFromCsv(csvText: string): SuggestedFact[] {
  let parsed: ReturnType<typeof parseWorkspaceCsv>;
  try {
    parsed = parseWorkspaceCsv(csvText, 200);
  } catch {
    return [];
  }
  const codeCol = columnFor(parsed.columns, FACT_COLUMN_ALIASES.item_code);
  if (!codeCol) return [];
  const nameCol = columnFor(parsed.columns, FACT_COLUMN_ALIASES.item_name);
  const refCol = columnFor(parsed.columns, FACT_COLUMN_ALIASES.reference_price);
  const ceilCol = columnFor(parsed.columns, FACT_COLUMN_ALIASES.ceiling_price);
  const collCol = columnFor(parsed.columns, FACT_COLUMN_ALIASES.collective_price);
  if (!refCol && !ceilCol && !collCol) return [];

  const out: SuggestedFact[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const code = String(row[codeCol] ?? "").trim();
    if (!code || seen.has(code)) continue;
    const fact: SuggestedFact = {
      item_code: code,
      item_name: nameCol ? String(row[nameCol] ?? "").trim() || undefined : undefined,
      reference_price: refCol ? moneyOf(row[refCol]) : undefined,
      ceiling_price: ceilCol ? moneyOf(row[ceilCol]) : undefined,
      collective_price: collCol ? moneyOf(row[collCol]) : undefined,
    };
    if (
      fact.reference_price === undefined &&
      fact.ceiling_price === undefined &&
      fact.collective_price === undefined
    ) {
      continue;
    }
    seen.add(code);
    out.push(fact);
    if (out.length >= 30) break;
  }
  return out;
}

function ensureUploadSource(db: ReturnType<typeof getDb>, now: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO policy_source
     (id, name, source_type, jurisdiction, base_url, access_level, crawl_strategy, robots_status, terms_status, rate_limit_per_min, enabled, notes, created_at, updated_at)
     VALUES (:id, :name, 'manual_upload', 'internal', NULL, 'internal', 'manual', 'not_applicable', 'not_applicable', 0, 1, :notes, :now, :now)`,
  ).run({
    id: UPLOAD_SOURCE_ID,
    name: "内网本地上传",
    notes: "医保内网无外网时的政策文件入口：上传留痕，人审确认后生效为 policy_fact。",
    now,
  });
}

export function ingestUploadedPolicyDocument(input: {
  fileName: string;
  buffer: Buffer;
  title?: string;
}): PolicyUploadResult {
  const fileName = input.fileName.trim() || "policy-upload";
  const artifactType = artifactTypeOf(fileName);
  const contentHash = createHash("sha256").update(input.buffer).digest("hex").slice(0, 16);
  const title = (input.title ?? fileName.replace(/\.[^.]+$/, "")).trim() || fileName;
  const url = `upload://${fileName}`;

  const db = getDb();
  const now = workspaceNow();
  ensureUploadSource(db, now);

  const existing = db
    .prepare(
      "SELECT id, status FROM policy_artifact WHERE source_id = :source_id AND url = :url AND content_hash = :hash LIMIT 1",
    )
    .get({ source_id: UPLOAD_SOURCE_ID, url, hash: contentHash }) as
    | { id: string; status: string }
    | null;
  if (existing) {
    return {
      ok: true,
      message: `这份文件之前已上传过（hash ${contentHash}，状态 ${existing.status}），未重复入库。`,
      artifactId: existing.id,
      contentHash,
      artifactType,
      duplicated: true,
    };
  }

  const suggestedFacts =
    artifactType === "csv" ? suggestFactsFromCsv(input.buffer.toString("utf8")) : [];

  const artifactId = workspaceId("ART");
  const runId = workspaceId("ING");
  db.prepare(
    `INSERT INTO policy_artifact
     (id, source_id, url, title, published_at, content_hash, artifact_type, parser_version, status, raw_meta_json, ingestion_run_id, created_at)
     VALUES (:id, :source_id, :url, :title, :published_at, :content_hash, :artifact_type, :parser_version, 'fetched', :raw_meta_json, :ingestion_run_id, :created_at)`,
  ).run({
    id: artifactId,
    source_id: UPLOAD_SOURCE_ID,
    url,
    title,
    published_at: now.slice(0, 10),
    content_hash: contentHash,
    artifact_type: artifactType,
    parser_version: artifactType === "csv" ? "upload-csv-v1" : "upload-raw-v1",
    raw_meta_json: JSON.stringify({
      fileName,
      byteSize: input.buffer.length,
      uploadedAt: now,
      suggestedFacts,
    }),
    ingestion_run_id: runId,
    created_at: now,
  });

  db.prepare(
    `INSERT INTO ingestion_run
     (id, source_id, trigger_type, status, started_at, finished_at, fetched_count, changed_count, parser_version, error_json, actor)
     VALUES (:id, :source_id, 'manual_upload', 'succeeded', :now, :now, 1, 1, :parser_version, NULL, 'policy-upload-api')`,
  ).run({
    id: runId,
    source_id: UPLOAD_SOURCE_ID,
    now,
    parser_version: artifactType === "csv" ? "upload-csv-v1" : "upload-raw-v1",
  });

  db.prepare("UPDATE policy_source SET last_checked_at = :now, updated_at = :now WHERE id = :id").run({
    now,
    id: UPLOAD_SOURCE_ID,
  });

  const parseNote =
    artifactType === "csv"
      ? suggestedFacts.length > 0
        ? `解析到 ${suggestedFacts.length} 条结构化价格事实建议，人审确认后生效。`
        : "未解析到结构化价格列（需要编码列 + 参考价/最高价/中选价任一列），请在确认表单人工录入。"
      : "已留痕入库；PDF/XLSX 请在确认表单人工录入结构化字段（事实生效必须人审）。";

  return {
    ok: true,
    message: `已接收「${fileName}」（hash ${contentHash}）。${parseNote}`,
    artifactId,
    contentHash,
    artifactType,
    suggestedFacts,
  };
}
