import "server-only";
import { getDb } from "./db";
import {
  ACCESS_POLICY,
  ACCESS_POLICY_VERSION,
  CODE_DICTIONARY_VERSION,
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

  return {
    releases: fixtures.length,
    rows: rowCount,
    manifests: fixtures.length,
    releaseIds: fixtures.map((f) => f.id),
    generatedAt: created,
  };
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
