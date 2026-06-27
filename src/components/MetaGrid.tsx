import type { DatasetRelease } from "@/lib/types";

const MONO_KEYS = new Set(["规则版本", "价格记录", "创建时间", "监测日"]);

export function MetaGrid({ release }: { release: DatasetRelease }) {
  const cells: { label: string; value: string; mono?: boolean }[] = [
    { label: "来源单位", value: release.publisher },
    { label: "治理域", value: release.domain },
    { label: "规则版本", value: release.version_label, mono: true },
    { label: "价格记录", value: release.record_count.toLocaleString("zh-CN"), mono: true },
    { label: "创建时间", value: release.created_at.slice(0, 16).replace("T", " "), mono: true },
    { label: "监测日", value: release.release_date, mono: true },
  ];
  return (
    <div className="meta-grid" data-release-meta>
      {cells.map((c) => (
        <div key={c.label}>
          <div className="meta-label">{c.label}</div>
          <div className={`meta-value${c.mono ? " mono" : ""}`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
