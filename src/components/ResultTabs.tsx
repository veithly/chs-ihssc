import Link from "next/link";

const TABS = [
  { key: "result", label: "结果", path: "result" },
  { key: "replay", label: "运行回放", path: "replay" },
  { key: "proof", label: "源清单与策略", path: "proof" },
  { key: "approval", label: "审批记录", path: "approval" },
];

export function ResultTabs({
  releaseId,
  active,
}: {
  releaseId: string;
  active: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        borderBottom: "1px solid var(--gate-border)",
        marginBottom: 16,
      }}
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/release/${releaseId}/${t.path}`}
            style={{
              padding: "9px 14px",
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--gate-accent)" : "var(--gate-ink-soft)",
              borderBottom: isActive
                ? "2px solid var(--gate-accent)"
                : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
