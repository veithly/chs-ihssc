import Link from "next/link";

const TABS = [
  { key: "result", label: "结果", path: "result" },
  { key: "replay", label: "运行回放", path: "replay" },
  { key: "proof", label: "目录与规则", path: "proof" },
  { key: "approval", label: "核验记录", path: "approval" },
];

export function ResultTabs({
  releaseId,
  active,
}: {
  releaseId: string;
  active: string;
}) {
  return (
    <nav className="result-tabs" aria-label="批次结果子页">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/release/${releaseId}/${t.path}`}
            className={`result-tab${isActive ? " active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
      <style>{`
        .result-tabs {
          display: flex;
          gap: 2px;
          border-bottom: 1px solid var(--gate-border);
          margin-bottom: 18px;
        }
        .result-tab {
          padding: 10px 14px;
          font-size: 13.5px;
          font-weight: 500;
          color: var(--gate-ink-soft);
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: color 140ms var(--ease-soft), border-color 140ms var(--ease-soft),
            background 140ms var(--ease-soft);
          border-radius: 6px 6px 0 0;
        }
        .result-tab:hover {
          color: var(--gate-ink);
          background: var(--surface-subtle);
        }
        .result-tab.active {
          color: var(--gate-ink);
          font-weight: 600;
          border-bottom-color: var(--gate-ink);
        }
      `}</style>
    </nav>
  );
}
