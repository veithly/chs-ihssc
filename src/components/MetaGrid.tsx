import type { DatasetRelease } from "@/lib/types";

export function MetaGrid({ release }: { release: DatasetRelease }) {
  const cells: { label: string; value: string }[] = [
    { label: "发布方", value: release.publisher },
    { label: "数据域", value: release.domain },
    { label: "发布版本", value: release.version_label },
    { label: "记录总数", value: release.record_count.toLocaleString("zh-CN") },
    { label: "创建时间", value: release.created_at.slice(0, 16).replace("T", " ") },
    { label: "发布日", value: release.release_date },
  ];
  return (
    <div className="meta-grid" data-release-meta>
      {cells.map((c) => (
        <div key={c.label}>
          <div className="meta-label">{c.label}</div>
          <div className="meta-value">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
