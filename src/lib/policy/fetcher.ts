import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "../db";
import { workspaceId, workspaceNow } from "../workspace/repo";

// ===== V2.2 政策采集（L0 公开源）：artifact / fact 分离 =====
// 链路：抓公告 → 落 policy_artifact（status=fetched，hash 留痕、幂等去重）
//      → 人审确认（confirm）→ 写/更新 policy_fact（status=verified 的结构化事实）
//      → 下次 run 用新 baseline 检出漂移。
// 政策事实未经人审确认不进入自动判定——这是产品设计，不是缺陷。
// 合规边界：只抓 L0 公开公告/附件；不碰登录/CA 平台、App 逆向、不公开支付标准。

export interface FetchResult {
  ingestionRunId: string;
  fetchedCount: number;
  changedCount: number;
  parserStatus: "ok" | "parse_failed";
  artifacts: PolicyArtifactMeta[];
  error?: string;
}

export interface PolicyArtifactMeta {
  url: string;
  title: string;
  publishedAt: string | null;
  documentNo: string | null;
  contentHash: string;
  artifactType: "html" | "pdf" | "xlsx" | "docx";
}

const NHSA_POLICY_INDEX = "https://www.nhsa.gov.cn/";
const SOURCE_ID = "PS-NHSA-POLICY-001";
const PARSER_VERSION = "html-index-v2";

// 抓取国家医保局政策公告列表页，解析公告元数据，artifact 落库留痕（不直接碰 policy_fact）。
export async function syncNhsaPolicySource(opts?: { dryRun?: boolean }): Promise<FetchResult> {
  const db = getDb();
  const runId = workspaceId("ING");
  const startedAt = new Date().toISOString();

  try {
    const html = await fetchWithRateLimit(NHSA_POLICY_INDEX);
    const parsed = parsePolicyIndex(html, NHSA_POLICY_INDEX);
    const parserStatus: "ok" | "parse_failed" = parsed.length > 0 ? "ok" : "parse_failed";

    if (opts?.dryRun) {
      return {
        ingestionRunId: runId,
        fetchedCount: parsed.length,
        changedCount: 0,
        parserStatus,
        artifacts: parsed,
      };
    }

    // artifact 落库：UNIQUE(source_id, url, content_hash) 幂等去重，只记新增。
    let changedCount = 0;
    const now = workspaceNow();
    for (const art of parsed) {
      const existing = db
        .prepare(
          "SELECT id FROM policy_artifact WHERE source_id = :source_id AND url = :url AND content_hash = :hash LIMIT 1",
        )
        .get({ source_id: SOURCE_ID, url: art.url, hash: art.contentHash });
      if (existing) continue;
      db.prepare(
        `INSERT INTO policy_artifact
         (id, source_id, url, title, published_at, content_hash, artifact_type, parser_version, status, raw_meta_json, ingestion_run_id, created_at)
         VALUES (:id, :source_id, :url, :title, :published_at, :content_hash, :artifact_type, :parser_version, 'fetched', :raw_meta_json, :ingestion_run_id, :created_at)`,
      ).run({
        id: workspaceId("ART"),
        source_id: SOURCE_ID,
        url: art.url,
        title: art.title,
        published_at: art.publishedAt,
        content_hash: art.contentHash,
        artifact_type: art.artifactType,
        parser_version: PARSER_VERSION,
        raw_meta_json: JSON.stringify({ documentNo: art.documentNo }),
        ingestion_run_id: runId,
        created_at: now,
      });
      changedCount += 1;
    }

    // ingestion_run 留痕：解析 0 条时标记 parse_failed（页面结构变化），不伪造 artifact。
    db.prepare(
      `INSERT INTO ingestion_run
       (id, source_id, trigger_type, status, started_at, finished_at, fetched_count, changed_count, parser_version, error_json, actor)
       VALUES (:id, :source_id, :trigger, :status, :started_at, :finished_at, :fetched, :changed, :parser_version, :error_json, :actor)`,
    ).run({
      id: runId,
      source_id: SOURCE_ID,
      trigger: "manual",
      status: parserStatus === "ok" ? "succeeded" : "parse_failed",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      fetched: parsed.length,
      changed: changedCount,
      parser_version: PARSER_VERSION,
      error_json:
        parserStatus === "ok"
          ? null
          : JSON.stringify({ error: "parser_no_match", note: "页面结构可能变化，需适配 parser；本次不落任何 artifact。" }),
      actor: "policy-sync-api",
    });

    db.prepare("UPDATE policy_source SET last_checked_at = :now, updated_at = :now WHERE id = :id").run({
      now: new Date().toISOString(),
      id: SOURCE_ID,
    });

    return {
      ingestionRunId: runId,
      fetchedCount: parsed.length,
      changedCount,
      parserStatus,
      artifacts: parsed,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // 失败也留痕
    db.prepare(
      `INSERT INTO ingestion_run
       (id, source_id, trigger_type, status, started_at, finished_at, fetched_count, changed_count, parser_version, error_json, actor)
       VALUES (:id, :source_id, 'manual', 'failed', :started_at, :finished_at, 0, 0, :parser_version, :error_json, 'policy-sync-api')`,
    ).run({
      id: runId,
      source_id: SOURCE_ID,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      parser_version: PARSER_VERSION,
      error_json: JSON.stringify({ error }),
    });
    return { ingestionRunId: runId, fetchedCount: 0, changedCount: 0, parserStatus: "parse_failed", artifacts: [], error };
  }
}

// 最近一次采集留痕（policy 面板展示"上次同步"用）。
export function getLatestIngestionRun(): {
  status: string;
  finished_at: string | null;
  fetched_count: number;
  changed_count: number;
} | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT status, finished_at, fetched_count, changed_count FROM ingestion_run ORDER BY started_at DESC LIMIT 1",
    )
    .get() as
    | { status: string; finished_at: string | null; fetched_count: number; changed_count: number }
    | undefined;
  return row ?? null;
}

// 列出 artifact（默认待审 fetched 在前）。
export function listPolicyArtifacts(status?: string): Array<Record<string, unknown>> {
  const db = getDb();
  if (status) {
    return db
      .prepare("SELECT * FROM policy_artifact WHERE status = :s ORDER BY created_at DESC")
      .all({ s: status });
  }
  return db.prepare("SELECT * FROM policy_artifact ORDER BY created_at DESC").all();
}

export interface ConfirmArtifactInput {
  artifactId: string;
  reviewer: string;
  // 人审录入/修正的结构化事实字段
  itemCode: string;
  itemName?: string;
  referencePrice?: number;
  ceilingPrice?: number;
  collectivePrice?: number;
}

// 人审确认一条 artifact：录入结构化字段 → 写/更新 policy_fact（事实生效）→ artifact 状态流转。
// 这是"公告 → 结构化政策事实"的产品链路：采集自动化，事实生效必须人审。
export function confirmPolicyArtifact(input: ConfirmArtifactInput): {
  ok: boolean;
  message: string;
  factId?: string;
  driftExpected?: boolean;
} {
  const db = getDb();
  const artifact = db
    .prepare("SELECT * FROM policy_artifact WHERE id = :id LIMIT 1")
    .get({ id: input.artifactId }) as
    | { id: string; url: string; title: string; content_hash: string; status: string }
    | null;
  if (!artifact) {
    return { ok: false, message: "未找到该公告。" };
  }
  if (artifact.status !== "fetched") {
    return { ok: false, message: "该公告已确认过，不能重复确认。" };
  }
  const itemCode = input.itemCode.trim();
  if (!itemCode) {
    return { ok: false, message: "缺少医保项目编码，无法生效。" };
  }

  const now = workspaceNow();
  const factId = upsertFactForArtifact(
    db,
    { url: artifact.url, content_hash: artifact.content_hash, title: artifact.title },
    {
      item_code: itemCode,
      item_name: input.itemName,
      reference_price: input.referencePrice,
      ceiling_price: input.ceilingPrice,
      collective_price: input.collectivePrice,
    },
    now,
  );

  db.prepare(
    "UPDATE policy_artifact SET status = 'confirmed', reviewer = :reviewer, reviewed_at = :now WHERE id = :id",
  ).run({ reviewer: input.reviewer, now, id: artifact.id });

  return {
    ok: true,
    message: `已人审确认，${itemCode} 的政策口径已生效（依据留痕 #${artifact.content_hash.slice(0, 8)}）。下次核查将按新口径比对，超出的执行价会被点名。`,
    factId,
    driftExpected: true,
  };
}

export interface ArtifactFactInput {
  item_code: string;
  item_name?: string;
  reference_price?: number;
  ceiling_price?: number;
  collective_price?: number;
}

// 批量确认（内网上传 CSV 解析出的结构化事实）：一次人审确认 N 条 policy_fact 生效。
// 与单条 confirm 同一 upsert 逻辑、同一 source_hash 追溯口径。
export function confirmPolicyArtifactFacts(input: {
  artifactId: string;
  reviewer: string;
  facts: ArtifactFactInput[];
}): { ok: boolean; message: string; confirmedCount?: number; driftExpected?: boolean } {
  const db = getDb();
  const artifact = db
    .prepare("SELECT * FROM policy_artifact WHERE id = :id LIMIT 1")
    .get({ id: input.artifactId }) as
    | { id: string; url: string; title: string; content_hash: string; status: string }
    | null;
  if (!artifact) return { ok: false, message: "未找到该公告。" };
  if (artifact.status !== "fetched") {
    return { ok: false, message: "该公告已确认过，不能重复确认。" };
  }
  const facts = input.facts.filter((f) => f.item_code?.trim());
  if (facts.length === 0) {
    return { ok: false, message: "没有可确认的结构化事实（缺少医保项目编码）。" };
  }

  const now = workspaceNow();
  for (const fact of facts) {
    upsertFactForArtifact(
      db,
      { url: artifact.url, content_hash: artifact.content_hash, title: artifact.title },
      { ...fact, item_code: fact.item_code.trim() },
      now,
    );
  }

  db.prepare(
    "UPDATE policy_artifact SET status = 'confirmed', reviewer = :reviewer, reviewed_at = :now WHERE id = :id",
  ).run({ reviewer: input.reviewer, now, id: artifact.id });

  return {
    ok: true,
    message: `已人审确认，${facts.length} 条政策口径已生效（依据留痕 #${artifact.content_hash.slice(0, 8)}）。下次核查将按新口径比对，超出的执行价会被点名。`,
    confirmedCount: facts.length,
    driftExpected: true,
  };
}

// 写/更新单条 policy_fact（source_url/source_hash 指向 artifact，版本演进可追溯）。
function upsertFactForArtifact(
  db: ReturnType<typeof getDb>,
  artifact: { url: string; content_hash: string; title: string },
  fact: ArtifactFactInput,
  now: string,
): string {
  const itemCode = fact.item_code;
  const existing = db
    .prepare(
      "SELECT id FROM policy_fact WHERE item_code = :code ORDER BY created_at DESC LIMIT 1",
    )
    .get({ code: itemCode }) as { id: string } | null;

  if (existing) {
    db.prepare(
      `UPDATE policy_fact
       SET reference_price = COALESCE(:ref, reference_price),
           ceiling_price = COALESCE(:ceil, ceiling_price),
           collective_price = COALESCE(:coll, collective_price),
           source_url = :url,
           source_hash = :hash
       WHERE id = :id`,
    ).run({
      ref: fact.reference_price ?? null,
      ceil: fact.ceiling_price ?? null,
      coll: fact.collective_price ?? null,
      url: artifact.url,
      hash: artifact.content_hash,
      id: existing.id,
    });
    return existing.id;
  }

  const factId = `PF-${itemCode}-${Date.now()}`;
  const factBody = JSON.stringify({ itemCode, artifact: artifact.content_hash });
  db.prepare(
    `INSERT INTO policy_fact
     (id, item_code, item_name, category, unit, reference_price, ceiling_price, collective_price, landed_regions_json, effective_start, effective_end, jurisdiction, source_url, source_hash, confidentiality_level, fact_hash, created_at)
     VALUES (:id, :item_code, :item_name, NULL, NULL, :ref, :ceil, :coll, '[]', :effective_start, NULL, 'national', :url, :hash, 'public', :fact_hash, :created_at)`,
  ).run({
    id: factId,
    item_code: itemCode,
    item_name: fact.item_name ?? artifact.title,
    ref: fact.reference_price ?? null,
    ceil: fact.ceiling_price ?? null,
    coll: fact.collective_price ?? null,
    effective_start: now.slice(0, 10),
    url: artifact.url,
    hash: artifact.content_hash,
    fact_hash: createHash("sha256").update(factBody).digest("hex").slice(0, 16),
    created_at: now,
  });
  return factId;
}

export function rejectPolicyArtifact(artifactId: string, reviewer: string): { ok: boolean; message: string } {
  const db = getDb();
  const result = db
    .prepare("UPDATE policy_artifact SET status = 'rejected', reviewer = :reviewer, reviewed_at = :now WHERE id = :id AND status = 'fetched'")
    .run({ reviewer, now: workspaceNow(), id: artifactId });
  if ((result.changes ?? 0) === 0) {
    return { ok: false, message: "未找到待审 artifact，或状态已变更。" };
  }
  return { ok: true, message: "artifact 已标记为 rejected，不会生成政策事实。" };
}

// 限频 fetch（尊重站点，默认 4 req/min；这里单页一次请求）
async function fetchWithRateLimit(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "JiaxuPolicyBot/1.0 (medicaid-price-governance; +research; respect-robots-txt)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

// 解析国家医保局首页 HTML，提取公告元数据。
// 医保局首页公告模式：<a href="/art/YYYY/M/D/art_XX_XXXXX.html" title="公告标题">...
// 解析失败（页面结构变化）返回空数组 → 上层标记 parse_failed，不伪造占位数据。
function parsePolicyIndex(html: string, baseUrl: string): PolicyArtifactMeta[] {
  const artifacts: PolicyArtifactMeta[] = [];

  const linkRegex = /href="([^"]*?\/art\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/art_\d+_\d+\.html)"[^>]*title="([^"]{4,80})"/gi;
  const seenUrls = new Set<string>();

  for (const m of html.matchAll(linkRegex)) {
    const rawUrl = m[1];
    const year = m[2];
    const month = m[3];
    const day = m[4];
    const title = (m[5] ?? "").trim();
    if (!title || title.length < 4) continue;

    const fullUrl = rawUrl.startsWith("http") ? rawUrl : new URL(rawUrl, baseUrl).toString();
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    const publishedAt = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const contentHash = createHash("sha256")
      .update(fullUrl + title + publishedAt)
      .digest("hex")
      .slice(0, 16);

    artifacts.push({
      url: fullUrl,
      title,
      publishedAt,
      documentNo: null,
      contentHash,
      artifactType: "html",
    });
  }

  return artifacts.slice(0, 20); // 限频：最多记 20 条
}
