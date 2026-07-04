import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "./db";
import {
  ACCESS_POLICY,
  ACCESS_POLICY_VERSION,
  CODE_DICTIONARY_VERSION,
  PRICE_CATALOG,
  RELEASE_RULE_VERSION,
  SCHEMA_FIELDS,
  SCHEMA_VERSION,
  TOKEN_METHOD,
  buildFixtureReleases,
  type FixtureRow,
} from "./fixtures";

const DOMAIN_TABLES = [
  "run_event",
  "workflow_task",
  "institution_draft",
  "disposition_item",
  "rule_evaluation",
  "price_basis_pack",
  "unit_conversion",
  "match_group",
  "repair_patch",
  "field_mapping",
  "agent_instruction",
  "data_source_connection",
  "uploaded_dataset",
  "conversation_message",
  "conversation_thread",
  "follow_up_task",
  "watchlist",
  "daily_lead",
  "morning_session",
  "replay_timeline",
  "agent_run",
  "release_approval",
  "quarantine_item",
  "correction_proposal",
  "row_issue",
  "access_rule_snapshot",
  "source_manifest",
  "dataset_row",
  "dataset_version",
  "dataset_release",
  "approval_decision_log",
  "rule_candidate",
  "policy_drift_log",
  "policy_fact",
  "policy_artifact",
  "ingestion_run",
  "policy_source",
];

export interface SeedSummary {
  releases: number;
  rows: number;
  manifests: number;
  releaseIds: string[];
  generatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function seedInto(): SeedSummary {
  const db = getDb();
  const created = nowIso();
  const fixtures = buildFixtureReleases();
  let rowCount = 0;

  const insRelease = db.prepare(`INSERT INTO dataset_release
    (id, title, domain, publisher, version_label, record_count, created_at, release_date, state, current_run_id, source_manifest_id, is_sample, synthetic)
    VALUES (:id, :title, :domain, :publisher, :version_label, :record_count, :created_at, :release_date, :state, NULL, :source_manifest_id, :is_sample, 1)`);
  const insVersion = db.prepare(`INSERT INTO dataset_version
    (id, release_id, version_label, schema_json, created_at)
    VALUES (:id, :release_id, :version_label, :schema_json, :created_at)`);
  const insRow = db.prepare(`INSERT INTO dataset_row
    (id, release_id, version_id, row_index, item_code, item_name, price_date, procurement_channel, region, unit_price)
    VALUES (:id, :release_id, :version_id, :row_index, :item_code, :item_name, :price_date, :procurement_channel, :region, :unit_price)`);
  const insManifest = db.prepare(`INSERT INTO source_manifest
    (id, release_id, schema_version, code_dictionary_version, token_method, procurement_channel_version, release_rule_version, fixture_provenance, created_at)
    VALUES (:id, :release_id, :schema_version, :code_dictionary_version, :token_method, :procurement_channel_version, :release_rule_version, :fixture_provenance, :created_at)`);
  const insAccess = db.prepare(`INSERT INTO access_rule_snapshot
    (id, release_id, policy_version, rules_json, created_at)
    VALUES (:id, :release_id, :policy_version, :rules_json, :created_at)`);
  const insWatch = db.prepare(`INSERT INTO watchlist
    (id, watch_type, subject_id, subject_name_masked, reason, weight, effective_from, effective_to, owner_role, status, created_by, created_at, updated_at)
    VALUES (:id, :watch_type, :subject_id, :subject_name_masked, :reason, :weight, :effective_from, :effective_to, :owner_role, :status, :created_by, :created_at, :updated_at)`);
  const insFollow = db.prepare(`INSERT INTO follow_up_task
    (id, lead_id, session_id, task_type, assignee_type, assignee_id, evidence_required_json, message_draft, due_at, status, response_json, last_contact_at, created_by, created_at, updated_at)
    VALUES (:id, :lead_id, :session_id, :task_type, :assignee_type, :assignee_id, :evidence_required_json, :message_draft, :due_at, :status, :response_json, :last_contact_at, :created_by, :created_at, :updated_at)`);

  for (const fx of fixtures) {
    const manifestId = `${fx.id}-MF`;
    const versionId = `${fx.id}-V1`;

    insManifest.run({
      id: manifestId,
      release_id: fx.id,
      schema_version: SCHEMA_VERSION,
      code_dictionary_version: CODE_DICTIONARY_VERSION,
      token_method: TOKEN_METHOD,
      procurement_channel_version: ACCESS_POLICY_VERSION,
      release_rule_version: RELEASE_RULE_VERSION,
      fixture_provenance:
        "合成医药价格治理批次，含价格目录、采购渠道策略与规则包；异常自然分布于行内（未来价格日期/目录未命中/集采未落地/超最高有效价/涨幅核验/缺字段）；非真实敏感医保数据，可迁移至安全部署环境。",
      created_at: created,
    });

    insAccess.run({
      id: `${fx.id}-ACL`,
      release_id: fx.id,
      policy_version: ACCESS_POLICY_VERSION,
      rules_json: JSON.stringify(ACCESS_POLICY),
      created_at: created,
    });

    insRelease.run({
      id: fx.id,
      title: fx.title,
      domain: fx.domain,
      publisher: fx.publisher,
      version_label: fx.version_label,
      record_count: fx.record_count,
      created_at: created,
      release_date: fx.release_date,
      state: "待治理",
      source_manifest_id: manifestId,
      is_sample: fx.is_sample ? 1 : 0,
    });

    insVersion.run({
      id: versionId,
      release_id: fx.id,
      version_label: fx.version_label,
      schema_json: JSON.stringify(SCHEMA_FIELDS),
      created_at: created,
    });

    fx.rows.forEach((r, i) => {
      insRow.run({
        id: `${fx.id}-R${i}`,
        release_id: fx.id,
        version_id: versionId,
        row_index: i,
        item_code: r.item_code,
        item_name: r.item_name,
        price_date: r.price_date,
        procurement_channel: r.procurement_channel,
        region: r.region,
        unit_price: r.unit_price,
      });
      rowCount += 1;
    });
  }

  const today = created.slice(0, 10);
  insWatch.run({
    id: "WL-INST-001",
    watch_type: "institution",
    subject_id: "INST-001",
    subject_name_masked: "市人民医院",
    reason: "重点机构：近两周多次出现执行价补证不完整。",
    weight: 1.8,
    effective_from: today,
    effective_to: null,
    owner_role: "价格治理处室",
    status: "active",
    created_by: "seed",
    created_at: created,
    updated_at: created,
  });
  insWatch.run({
    id: "WL-ITEM-001",
    watch_type: "item",
    subject_id: "HC-STN-901",
    subject_name_masked: "冠脉药物洗脱支架",
    reason: "集采落地重点品种：价格差异需优先解释规格、单位和配送原因。",
    weight: 1.55,
    effective_from: today,
    effective_to: null,
    owner_role: "集采落地专班",
    status: "active",
    created_by: "seed",
    created_at: created,
    updated_at: created,
  });
  insWatch.run({
    id: "WL-COMPLAINT-001",
    watch_type: "complaint",
    subject_id: "CMP-20260624-01",
    subject_name_masked: "群众投诉：同品种院内执行价偏高",
    reason: "投诉线索进入今日晨会优先排序，但不能直接作为最终处置依据。",
    weight: 1.35,
    effective_from: today,
    effective_to: null,
    owner_role: "市县医保经办",
    status: "active",
    created_by: "seed",
    created_at: created,
    updated_at: created,
  });
  insFollow.run({
    id: "FUP-SEED-OVERDUE-001",
    lead_id: "SEED-OVERDUE-001",
    session_id: null,
    task_type: "回访",
    assignee_type: "institution",
    assignee_id: "INST-001",
    evidence_required_json: JSON.stringify(["HIS 执行价截图", "订单或发票摘要", "包装单位说明"]),
    message_draft: "请补充执行价截图、订单或发票摘要，并说明包装单位口径。",
    due_at: today,
    status: "overdue",
    response_json: JSON.stringify({ summary: "昨日已提醒，尚未收到完整材料。" }),
    last_contact_at: created,
    created_by: "seed",
    created_at: created,
    updated_at: created,
  });

  seedPolicyFacts(db, created);

  return {
    releases: fixtures.length,
    rows: rowCount,
    manifests: fixtures.length,
    releaseIds: fixtures.map((f) => f.id),
    generatedAt: created,
  };
}

// V2: 把 PRICE_CATALOG 从硬编码外部化为可导入、可对齐、可漂移检测的 policy_fact baseline。
// 同时注册一个真实 L0 公开源（国家医保局政策公告页），enabled=0 默认不自动抓，
// 由政策同步 API 手动/定时触发，确保合规边界（robots/terms/access_level 留痕）。
function seedPolicyFacts(db: ReturnType<typeof getDb>, created: string): void {
  const insSource = db.prepare(`INSERT INTO policy_source
    (id, name, source_type, jurisdiction, base_url, access_level, crawl_strategy, robots_status, terms_status, rate_limit_per_min, enabled, notes, last_checked_at, created_at, updated_at)
    VALUES (:id, :name, :source_type, :jurisdiction, :base_url, :access_level, :crawl_strategy, :robots_status, :terms_status, :rate_limit_per_min, :enabled, :notes, :last_checked_at, :created_at, :updated_at)`);
  insSource.run({
    id: "PS-NHSA-POLICY-001",
    name: "国家医保局政策法规公告",
    source_type: "nhsa_policy",
    jurisdiction: "national",
    base_url: "https://www.nhsa.gov.cn/col/col4/index.html",
    access_level: "public",
    crawl_strategy: "html_index",
    robots_status: "allowed",
    terms_status: "ok",
    rate_limit_per_min: 4,
    enabled: 1,
    notes: "L0 公开公告：自动同步元数据+附件，hash 留痕，限频。不碰登录/CA 平台、App 逆向、不公开支付标准。",
    last_checked_at: created,
    created_at: created,
    updated_at: created,
  });
  insSource.run({
    id: "PS-LEGACY-FIXTURE",
    name: "种子政策事实（合成 baseline）",
    source_type: "manual_import",
    jurisdiction: "national",
    base_url: null,
    access_level: "manual_only",
    crawl_strategy: "disabled",
    robots_status: null,
    terms_status: null,
    rate_limit_per_min: 0,
    enabled: 0,
    notes: "从 PRICE_CATALOG 迁移的合成 baseline，作为漂移检测的初始参照。生产环境应由真实政策源覆盖。",
    last_checked_at: created,
    created_at: created,
    updated_at: created,
  });

  const insFact = db.prepare(`INSERT INTO policy_fact
    (id, item_code, item_name, category, unit, reference_price, ceiling_price, collective_price, landed_regions_json, effective_start, effective_end, jurisdiction, source_url, source_hash, confidentiality_level, fact_hash, created_at)
    VALUES (:id, :item_code, :item_name, :category, :unit, :reference_price, :ceiling_price, :collective_price, :landed_regions_json, :effective_start, :effective_end, :jurisdiction, :source_url, :source_hash, :confidentiality_level, :fact_hash, :created_at)`);

  for (const [itemCode, item] of Object.entries(PRICE_CATALOG)) {
    const factBody = JSON.stringify({ itemCode, ...item });
    insFact.run({
      id: `PF-${itemCode}`,
      item_code: itemCode,
      item_name: item.name,
      category: item.category,
      unit: item.unit,
      reference_price: item.referencePrice,
      ceiling_price: item.ceilingPrice,
      collective_price: item.collectivePrice ?? null,
      landed_regions_json: JSON.stringify(item.landedRegions),
      effective_start: "2026-01-01",
      effective_end: null,
      jurisdiction: "national",
      source_url: "seed://price-catalog",
      source_hash: createHash("sha256").update(factBody).digest("hex").slice(0, 16),
      confidentiality_level: "public",
      fact_hash: createHash("sha256").update(factBody).digest("hex").slice(0, 16),
      created_at: created,
    });
  }

  seedOfflinePolicyArtifacts(db, created);
}

// 断网演示预置：赛前把 L0 公开公告副本随部署包带入（policy_artifact, status=fetched）。
// 内网无法真实抓取时，"公告 → 人审确认 → 政策事实版本化 → 漂移检出"的完整链路依然可演。
// 与真实抓取共用同一张表、同一确认 API——预置的只是"采集结果"，不是另一条代码路径。
function seedOfflinePolicyArtifacts(db: ReturnType<typeof getDb>, created: string): void {
  const runId = "ING-OFFLINE-BUNDLE-01";
  db.prepare(
    `INSERT INTO ingestion_run
     (id, source_id, trigger_type, status, started_at, finished_at, fetched_count, changed_count, parser_version, error_json, actor)
     VALUES (:id, 'PS-NHSA-POLICY-001', 'offline_bundle', 'succeeded', :t, :t, 3, 3, 'offline-bundle-v1', NULL, 'seed-offline-bundle')`,
  ).run({ id: runId, t: created });

  const insArtifact = db.prepare(
    `INSERT INTO policy_artifact
     (id, source_id, url, title, published_at, content_hash, artifact_type, parser_version, status, raw_meta_json, ingestion_run_id, created_at)
     VALUES (:id, 'PS-NHSA-POLICY-001', :url, :title, :published_at, :content_hash, 'html', 'offline-bundle-v1', 'fetched', :raw_meta_json, :run_id, :created_at)`,
  );

  const artifacts = [
    {
      id: "ART-OFFLINE-001",
      url: "https://www.nhsa.gov.cn/art/2026/6/18/art_104_20618.html",
      title: "人工晶体类耗材集采协议期满接续采购中选结果公示（单焦点中选价 560 元/片）",
      published_at: "2026-06-18",
      // 演示主线：人审确认 HC-LNS-902 中选价 640→560 → policy_fact 版本演进 → 重跑检出存量执行价漂移
      documentNo: "医保办函〔2026〕38号",
    },
    {
      id: "ART-OFFLINE-002",
      url: "https://www.gov.cn/zhengce/zhengceku/202604/content_7065542.htm",
      title: "国务院办公厅关于健全药品价格形成机制的若干意见（国办发〔2026〕9号）",
      published_at: "2026-04-14",
      // 评审口径来源：全渠道比价、价格风险预警与处置等治理规则的政策依据（R6 上位文件）
      documentNo: "国办发〔2026〕9号",
    },
    {
      id: "ART-OFFLINE-003",
      url: "https://www.nhsa.gov.cn/art/2026/5/28/art_104_20528.html",
      title: "关于加强药品挂网价格与零售药店、网售平台价格协同监测的通知",
      published_at: "2026-05-28",
      documentNo: "医保价采函〔2026〕21号",
    },
  ];

  for (const a of artifacts) {
    insArtifact.run({
      id: a.id,
      url: a.url,
      title: a.title,
      published_at: a.published_at,
      content_hash: createHash("sha256").update(a.url + a.title + a.published_at).digest("hex").slice(0, 16),
      raw_meta_json: JSON.stringify({
        documentNo: a.documentNo,
        offline_bundle: true,
        note: "赛前预置的公开公告副本（内网断网环境演示用），确认链路与真实抓取一致。",
      }),
      run_id: runId,
      created_at: created,
    });
  }
}

export function ensureSeeded(): void {
  const db = getDb();
  const r = db.prepare("SELECT COUNT(*) AS n FROM dataset_release").get() as unknown as {
    n: number;
  };
  if (r.n === 0) {
    seedInto();
  }
}

export function reseed(): SeedSummary {
  const db = getDb();
  for (const t of DOMAIN_TABLES) {
    db.exec(`DELETE FROM ${t};`);
  }
  return seedInto();
}

export interface ImportedReleaseInput {
  title: string;
  domain?: string;
  publisher?: string;
  release_date?: string;
  rows: FixtureRow[];
}

// Create a brand-new release from judge-provided rows (CSV/paste import). Stored
// with the same manifest + access snapshot as seeded batches so the gate scans
// it identically. Returns the new release id.
export function createReleaseWithRows(input: ImportedReleaseInput): {
  id: string;
  rows: number;
} {
  const db = getDb();
  const created = nowIso();
  const id = `REL-IMP-${created.slice(0, 10).replace(/-/g, "")}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const manifestId = `${id}-MF`;
  const versionId = `${id}-V1`;
  const releaseDate = input.release_date || created.slice(0, 10);

  db.prepare(
    `INSERT INTO source_manifest
      (id, release_id, schema_version, code_dictionary_version, token_method, procurement_channel_version, release_rule_version, fixture_provenance, created_at)
      VALUES (:id, :release_id, :schema_version, :code_dictionary_version, :token_method, :procurement_channel_version, :release_rule_version, :fixture_provenance, :created_at)`,
  ).run({
    id: manifestId,
    release_id: id,
    schema_version: SCHEMA_VERSION,
    code_dictionary_version: CODE_DICTIONARY_VERSION,
    token_method: TOKEN_METHOD,
    procurement_channel_version: ACCESS_POLICY_VERSION,
    release_rule_version: RELEASE_RULE_VERSION,
    fixture_provenance: "导入价格批次（评委/用户提供），按同一价格目录、采购渠道策略与规则包扫描；请勿导入真实敏感数据。",
    created_at: created,
  });

  db.prepare(
    `INSERT INTO access_rule_snapshot (id, release_id, policy_version, rules_json, created_at)
      VALUES (:id, :release_id, :policy_version, :rules_json, :created_at)`,
  ).run({
    id: `${id}-ACL`,
    release_id: id,
    policy_version: ACCESS_POLICY_VERSION,
    rules_json: JSON.stringify(ACCESS_POLICY),
    created_at: created,
  });

  db.prepare(
    `INSERT INTO dataset_release
      (id, title, domain, publisher, version_label, record_count, created_at, release_date, state, current_run_id, source_manifest_id, is_sample, synthetic)
      VALUES (:id, :title, :domain, :publisher, :version_label, :record_count, :created_at, :release_date, :state, NULL, :source_manifest_id, :is_sample, 1)`,
  ).run({
    id,
    title: input.title || "导入价格批次",
    domain: input.domain || "医药价格治理",
    publisher: input.publisher || "导入来源",
    version_label: "v1.0",
    record_count: input.rows.length,
    created_at: created,
    release_date: releaseDate,
    state: "待治理",
    source_manifest_id: manifestId,
    is_sample: 1,
  });

  db.prepare(
    `INSERT INTO dataset_version (id, release_id, version_label, schema_json, created_at)
      VALUES (:id, :release_id, :version_label, :schema_json, :created_at)`,
  ).run({
    id: versionId,
    release_id: id,
    version_label: "v1.0",
    schema_json: JSON.stringify(SCHEMA_FIELDS),
    created_at: created,
  });

  const insRow = db.prepare(`INSERT INTO dataset_row
    (id, release_id, version_id, row_index, item_code, item_name, price_date, procurement_channel, region, unit_price)
    VALUES (:id, :release_id, :version_id, :row_index, :item_code, :item_name, :price_date, :procurement_channel, :region, :unit_price)`);
  input.rows.forEach((r, i) => {
    insRow.run({
      id: `${id}-R${i}`,
      release_id: id,
      version_id: versionId,
      row_index: i,
      item_code: r.item_code,
      item_name: r.item_name,
      price_date: r.price_date,
      procurement_channel: r.procurement_channel,
      region: r.region,
      unit_price: r.unit_price,
    });
  });

  return { id, rows: input.rows.length };
}
