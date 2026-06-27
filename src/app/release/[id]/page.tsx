import Link from "next/link";
import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ProviderStatusBar } from "@/components/ProviderStatusBar";
import { ReleaseGate } from "@/components/ReleaseGate";
import { getProviderStatus } from "@/lib/env";
import { getManifest, getRelease, getRows } from "@/lib/repo";
import {
  DENIED_PURPOSE_HINT,
  DENIED_ROLE_HINT,
  PRICE_OPTIONS,
  PROCUREMENT_CHANNELS,
  REGION_OPTIONS,
} from "@/lib/fixtures";

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
        <AppHeader active="价格治理" />
        <main className="release-empty">
          <h1>未找到该价格批次：{id}</h1>
          <p>
            可返回{" "}
            <Link href="/release/REL-2026-0623-07" className="release-empty-link">
              价格治理工作台
            </Link>
            ，或前往{" "}
            <Link href="/queue" className="release-empty-link">
              队列
            </Link>
            。
          </p>
        </main>
        <style>{`
          .release-empty {
            max-width: 720px;
            margin: 70px auto;
            padding: 24px;
            text-align: center;
          }
          .release-empty h1 {
            font-size: 22px;
            font-weight: 600;
            letter-spacing: -0.02em;
            color: var(--gate-ink);
            margin: 0 0 8px;
          }
          .release-empty p {
            color: var(--gate-ink-soft);
            font-size: 13.5px;
            margin: 0;
          }
          .release-empty-link {
            color: var(--gate-accent);
            font-weight: 600;
          }
        `}</style>
      </div>
    );
  }

  const rows = getRows(id);
  const manifest = getManifest(id);
  const status = getProviderStatus();

  const policyLabels = [...PROCUREMENT_CHANNELS];
  const regionOptions = [...REGION_OPTIONS, ...DENIED_ROLE_HINT];
  const unitPriceOptions = [...PRICE_OPTIONS, ...DENIED_PURPOSE_HINT];

  return (
    <div className="gate-shell">
      <AppHeader active="价格治理" />
      <Breadcrumb items={["价格治理", "价格批次", release.id]} />
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
          item_code: r.item_code,
          item_name: r.item_name,
          price_date: r.price_date,
          procurement_channel: r.procurement_channel,
          region: r.region,
          unit_price: r.unit_price,
        }))}
        providerConfigured={status.configured}
        isSample={release.is_sample === 1}
        regionOptions={regionOptions}
        unitPriceOptions={unitPriceOptions}
        channelOptions={policyLabels}
      />
      <ProviderStatusBar status={status} policyVersion={manifest?.procurement_channel_version} />
    </div>
  );
}
