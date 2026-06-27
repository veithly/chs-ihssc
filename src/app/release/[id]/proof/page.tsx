import { Badge } from "@radix-ui/themes";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ResultTabs } from "@/components/ResultTabs";
import { AuditExportButton } from "@/components/ClientButtons";
import {
  getAccessSnapshot,
  getIssuesByRun,
  getLatestRun,
  getManifest,
  getRelease,
} from "@/lib/repo";
import { RELEASE_RULES } from "@/lib/fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProofPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const release = getRelease(id);
  if (!release) {
    return (
      <div className="gate-shell">
        <AppHeader active="价格治理" />
        <main className="proof-empty">未找到价格批次 {id}</main>
      </div>
    );
  }
  const manifest = getManifest(id);
  const access = getAccessSnapshot(id);
  const run = getLatestRun(id);
  const policy = access
    ? (JSON.parse(access.rules_json) as Record<string, { regions: string[]; channels: string[]; note: string }>)
    : {};

  // Deep-clone to plain objects: node:sqlite rows have a null prototype and
  // cannot be passed directly to a Client Component.
  const auditPackage = JSON.parse(
    JSON.stringify({
      exported_at: new Date().toISOString(),
      release: {
        id: release.id,
        title: release.title,
        state: release.state,
        record_count: release.record_count,
        synthetic: Boolean(release.synthetic),
      },
      source_manifest: manifest
        ? {
            schema_version: manifest.schema_version,
            code_dictionary_version: manifest.code_dictionary_version,
            token_method: manifest.token_method,
            procurement_channel_version: manifest.procurement_channel_version,
            release_rule_version: manifest.release_rule_version,
            fixture_provenance: manifest.fixture_provenance,
          }
        : null,
      procurement_rule_snapshot: access ? JSON.parse(access.rules_json) : null,
      release_rules: RELEASE_RULES,
      latest_run: run
        ? {
            id: run.id,
            result_state: run.result_state,
            status: run.status,
            output_hash: run.output_hash,
            provider_meta: JSON.parse(run.provider_meta_json),
            issues: getIssuesByRun(run.id).map((i) => ({
              type: i.type,
              severity: i.severity,
            })),
          }
        : null,
    }),
  );

  const manifestRows: { label: string; value: string }[] = [
    { label: "价格 schema", value: manifest?.schema_version ?? "-" },
    { label: "价格目录版本", value: manifest?.code_dictionary_version ?? "-" },
    { label: "参考价来源", value: manifest?.token_method ?? "-" },
    { label: "渠道策略版本", value: manifest?.procurement_channel_version ?? "-" },
    { label: "治理规则版本", value: manifest?.release_rule_version ?? "-" },
    { label: "数据来源", value: manifest?.fixture_provenance ?? "-" },
  ];

  return (
    <div className="gate-shell">
      <AppHeader active="价格治理" />
      <Breadcrumb items={["价格治理", "价格批次", id, "目录与规则"]} />
      <main className="proof-shell">
        <ResultTabs releaseId={id} active="proof" />

        <div data-source-manifest className="proof-grid">
          <section className="gate-card proof-main">
            <div className="proof-main-head">
              <strong>价格目录与源清单</strong>
              <Badge data-policy-version variant="soft" color="blue" radius="full">
                {manifest?.procurement_channel_version}
              </Badge>
            </div>
            <dl className="proof-manifest">
              {manifestRows.map((r, i) => (
                <div
                  key={r.label}
                  className="proof-manifest-row"
                  style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-soft)" }}
                >
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>

            <div className="proof-rules-head">治理规则 · Governance Rules</div>
            <ul className="proof-rules">
              {RELEASE_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>

            <div className="proof-export-row">
              <AuditExportButton data={auditPackage} filename={`price-governance-${release.id}.json`} />
            </div>
          </section>

          <aside className="gate-card proof-side">
            <div className="proof-side-head">
              <strong>采购渠道策略快照</strong>
              <span className="mono proof-side-meta">{Object.keys(policy).length} channels</span>
            </div>
            {Object.entries(policy).map(([label, p]) => (
              <div key={label} className="proof-policy-card">
                <div className="proof-policy-title">{label}</div>
                <div className="proof-policy-label">适用地区</div>
                <div className="proof-policy-badges">
                  {p.regions.map((r) => (
                    <Badge key={r} variant="soft" color="green" size="1" radius="full">{r}</Badge>
                  ))}
                </div>
                <div className="proof-policy-label">渠道</div>
                <div className="proof-policy-badges">
                  {p.channels.map((r) => (
                    <Badge key={r} variant="soft" color="blue" size="1" radius="full">{r}</Badge>
                  ))}
                </div>
                <div className="proof-policy-note">{p.note}</div>
              </div>
            ))}
            <p className="proof-side-foot">
              该快照在价格治理时被 collective_landing_tracker 读取；未落地地区或未知渠道将进入「需核验」。
            </p>
          </aside>
        </div>
      </main>
      <style>{`
        .proof-shell {
          max-width: 1320px;
          margin: 0 auto;
          padding: 14px 24px 40px;
        }
        .proof-empty {
          max-width: 720px;
          margin: 60px auto;
          padding: 24px;
          text-align: center;
          color: var(--gate-ink-soft);
        }
        .proof-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }
        .proof-main, .proof-side { padding: 22px; }
        .proof-main-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 16px;
        }
        .proof-main-head strong {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .proof-manifest {
          margin: 0;
          border: 1px solid var(--gate-border);
          border-radius: 10px;
          overflow: hidden;
          background: var(--surface-subtle);
        }
        .proof-manifest-row {
          display: grid;
          grid-template-columns: 140px minmax(0, 1fr);
          gap: 12px;
          padding: 12px 14px;
        }
        .proof-manifest-row dt {
          color: var(--ink-3);
          font-size: 11.5px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-weight: 600;
        }
        .proof-manifest-row dd {
          margin: 0;
          font-size: 13px;
          color: var(--gate-ink);
          line-height: 1.55;
        }
        .proof-rules-head {
          margin: 22px 0 10px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .proof-rules {
          margin: 0;
          padding-left: 18px;
          font-size: 13px;
          line-height: 1.85;
          color: var(--gate-ink);
        }
        .proof-export-row {
          margin-top: 22px;
        }
        .proof-side-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 14px;
        }
        .proof-side-head strong {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .proof-side-meta {
          font-size: 10.5px;
          color: var(--ink-3);
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--surface-sunken);
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-weight: 600;
        }
        .proof-policy-card {
          border: 1px solid var(--gate-border);
          border-radius: 10px;
          background: var(--surface-subtle);
          padding: 14px 16px;
          margin-bottom: 10px;
        }
        .proof-policy-title {
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 10px;
          color: var(--gate-ink);
        }
        .proof-policy-label {
          font-size: 10.5px;
          color: var(--ink-3);
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-weight: 600;
          margin-bottom: 5px;
        }
        .proof-policy-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-bottom: 10px;
        }
        .proof-policy-note {
          font-size: 12px;
          color: var(--gate-ink-soft);
          line-height: 1.55;
          margin-top: 8px;
        }
        .proof-side-foot {
          font-size: 11.5px;
          color: var(--ink-3);
          line-height: 1.6;
          margin-top: 10px;
        }
        @media (max-width: 820px) {
          .proof-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
