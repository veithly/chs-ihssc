import Link from "next/link";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ProviderStatusBar } from "@/components/ProviderStatusBar";
import { ReleaseGate } from "@/components/ReleaseGate";
import { getProviderStatus } from "@/lib/env";
import { getManifest, getRelease, getRows } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReleaseGatePage({
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
        <div style={{ maxWidth: 720, margin: "60px auto", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22 }}>未找到该发布批次：{id}</h1>
          <p style={{ color: "var(--gate-ink-soft)" }}>
            可返回 <Link href="/release/REL-2026-0623-07" style={{ color: "var(--gate-accent)" }}>数据通行工作台</Link>
            ，或前往 <Link href="/queue" style={{ color: "var(--gate-accent)" }}>队列</Link>。
          </p>
        </div>
      </div>
    );
  }

  const rows = getRows(id);
  const manifest = getManifest(id);
  const status = getProviderStatus();

  return (
    <div className="gate-shell">
      <AppHeader active="数据通行" />
      <Breadcrumb items={["数据通行", "数据集发布", release.id]} />
      <ReleaseGate
        release={{
          id: release.id,
          title: release.title,
          publisher: release.publisher,
          domain: release.domain,
          version_label: release.version_label,
          record_count: release.record_count,
          created_at: release.created_at,
          release_date: release.release_date,
          state: release.state,
        }}
        rows={rows.map((r) => ({
          id: r.id,
          row_index: r.row_index,
          person_token: r.person_token,
          catalog_code: r.catalog_code,
          service_date: r.service_date,
          access_policy: r.access_policy,
        }))}
        highlightIndex={2}
        providerConfigured={status.configured}
      />
      <ProviderStatusBar status={status} policyVersion={manifest?.access_policy_version} />
    </div>
  );
}
