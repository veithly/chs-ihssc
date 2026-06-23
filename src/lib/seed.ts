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
} from "./fixtures";

const DOMAIN_TABLES = [
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
    (id, release_id, version_id, row_index, person_token, catalog_code, service_date, access_policy, requester_role, purpose)
    VALUES (:id, :release_id, :version_id, :row_index, :person_token, :catalog_code, :service_date, :access_policy, :requester_role, :purpose)`);
  const insManifest = db.prepare(`INSERT INTO source_manifest
    (id, release_id, schema_version, code_dictionary_version, token_method, access_policy_version, release_rule_version, fixture_provenance, created_at)
    VALUES (:id, :release_id, :schema_version, :code_dictionary_version, :token_method, :access_policy_version, :release_rule_version, :fixture_provenance, :created_at)`);
  const insAccess = db.prepare(`INSERT INTO access_rule_snapshot
    (id, release_id, policy_version, rules_json, created_at)
    VALUES (:id, :release_id, :policy_version, :rules_json, :created_at)`);

  for (const fx of fixtures) {
    const manifestId = `${fx.id}-MF`;
    const versionId = `${fx.id}-V1`;

    insManifest.run({
      id: manifestId,
      release_id: fx.id,
      schema_version: SCHEMA_VERSION,
      code_dictionary_version: CODE_DICTIONARY_VERSION,
      token_method: TOKEN_METHOD,
      access_policy_version: ACCESS_POLICY_VERSION,
      release_rule_version: RELEASE_RULE_VERSION,
      fixture_provenance:
        "合成脱敏样例数据，含源清单；非真实敏感医保数据；可迁移至安全部署环境。",
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
      state: "待发布",
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
        person_token: r.person_token,
        catalog_code: r.catalog_code,
        service_date: r.service_date,
        access_policy: r.access_policy,
        requester_role: r.requester_role,
        purpose: r.purpose,
      });
      rowCount += 1;
    });
  }

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
