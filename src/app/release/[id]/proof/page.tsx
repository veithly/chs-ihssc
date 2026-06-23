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
        <AppHeader active="数据通行" />
        <div style={{ maxWidth: 720, margin: "60px auto", textAlign: "center" }}>未找到发布批次 {id}</div>
      </div>
    );
  }
  const manifest = getManifest(id);
  const access = getAccessSnapshot(id);
  const run = getLatestRun(id);
  const policy = access ? (JSON.parse(access.rules_json) as Record<string, { allowedRoles: string[]; allowedPurposes: string[] }>) : {};

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
            access_policy_version: manifest.access_policy_version,
            release_rule_version: manifest.release_rule_version,
            fixture_provenance: manifest.fixture_provenance,
          }
        : null,
      access_rule_snapshot: access ? JSON.parse(access.rules_json) : null,
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
    { label: "schema 版本", value: manifest?.schema_version ?? "-" },
    { label: "目录字典版本", value: manifest?.code_dictionary_version ?? "-" },
    { label: "身份匹配方法", value: manifest?.token_method ?? "-" },
    { label: "访问策略版本", value: manifest?.access_policy_version ?? "-" },
    { label: "发布规则版本", value: manifest?.release_rule_version ?? "-" },
    { label: "数据来源", value: manifest?.fixture_provenance ?? "-" },
  ];

  return (
    <div className="gate-shell">
      <AppHeader active="数据通行" />
      <Breadcrumb items={["数据通行", "数据集发布", id, "源清单与策略"]} />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "12px 24px 40px" }}>
        <ResultTabs releaseId={id} active="proof" />

        <div data-source-manifest className="result-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 20, alignItems: "start" }}>
          <section className="gate-card" style={{ padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <strong style={{ fontSize: 15 }}>源清单（Source Manifest）</strong>
              <Badge data-policy-version variant="soft" color="blue">{manifest?.access_policy_version}</Badge>
            </div>
            <div className="gate-card-flat">
              {manifestRows.map((r, i) => (
                <div key={r.label} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "12px 14px", borderTop: i === 0 ? "none" : "1px solid var(--gate-border)", fontSize: 13.5 }}>
                  <span style={{ color: "var(--gate-ink-soft)" }}>{r.label}</span>
                  <span style={{ lineHeight: 1.55 }}>{r.value}</span>
                </div>
              ))}
            </div>

            <strong style={{ display: "block", fontSize: 14, margin: "22px 0 10px" }}>发布规则（Release Rules）</strong>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.9, color: "var(--gate-ink)" }}>
              {RELEASE_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>

            <div style={{ marginTop: 22 }}>
              <AuditExportButton data={auditPackage} filename={`audit-${release.id}.json`} />
            </div>
          </section>

          <aside className="gate-card" style={{ padding: 22 }}>
            <strong style={{ fontSize: 15, display: "block", marginBottom: 14 }}>访问策略快照</strong>
            {Object.entries(policy).map(([label, p]) => (
              <div key={label} className="gate-card-flat" style={{ padding: 14, marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 13, color: "var(--gate-ink-soft)", marginBottom: 4 }}>允许角色</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {p.allowedRoles.map((r) => (
                    <Badge key={r} variant="soft" color="green" size="1">{r}</Badge>
                  ))}
                </div>
                <div style={{ fontSize: 13, color: "var(--gate-ink-soft)", marginBottom: 4 }}>允许用途</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {p.allowedPurposes.map((r) => (
                    <Badge key={r} variant="soft" color="blue" size="1">{r}</Badge>
                  ))}
                </div>
              </div>
            ))}
            <p style={{ fontSize: 12.5, color: "var(--gate-ink-soft)", lineHeight: 1.6, marginTop: 8 }}>
              该快照在通行检查时被 access_policy_evaluator 读取；越权角色/用途将进入「需审批」。
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
