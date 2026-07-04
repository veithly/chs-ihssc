import type { ProviderStatus } from "@/lib/env";

export function ProviderStatusBar({
  status,
  policyVersion,
}: {
  status: ProviderStatus;
  policyVersion?: string;
}) {
  return (
    <div className="provider-status-bar" data-provider-status-bar>
      <span
        className={`provider-status-dot ${status.configured ? "ok" : "warn"}`}
        aria-hidden
      />
      <span>
        模型服务 ·
        {status.configured
          ? ` 已接通 · ${status.model}`
          : " 未接通（仅保留确定性核查）"}
      </span>
      {policyVersion && (
        <>
          <span className="provider-status-sep" aria-hidden>·</span>
          <span className="mono">政策版本 {policyVersion}</span>
        </>
      )}
      <span className="provider-status-sep" aria-hidden>·</span>
      <span>合成脱敏数据</span>

      <style>{`
        .provider-status-bar {
          max-width: 1320px;
          margin: 0 auto;
          padding: 12px 24px 28px;
          font-size: 12px;
          color: var(--gate-ink-soft);
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .provider-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          display: inline-block;
        }
        .provider-status-dot.ok {
          background: var(--gate-green);
          box-shadow: 0 0 0 3px rgba(19, 122, 75, 0.14);
        }
        .provider-status-dot.warn {
          background: var(--gate-amber);
          box-shadow: 0 0 0 3px rgba(183, 110, 0, 0.14);
        }
        .provider-status-sep {
          opacity: 0.45;
          margin: 0 2px;
        }
        @media (max-width: 720px) {
          .provider-status-bar { padding: 10px 14px 22px; font-size: 11.5px; }
        }
      `}</style>
    </div>
  );
}
