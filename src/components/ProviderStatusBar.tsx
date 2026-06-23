import type { ProviderStatus } from "@/lib/env";

export function ProviderStatusBar({
  status,
  policyVersion,
}: {
  status: ProviderStatus;
  policyVersion?: string;
}) {
  return (
    <div
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "10px 24px 28px",
        fontSize: 12.5,
        color: "var(--gate-ink-soft)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: status.configured ? "var(--gate-green)" : "var(--gate-amber)",
          display: "inline-block",
        }}
      />
      <span>
        Provider：{status.configured ? `就绪（${status.baseUrlHost} · ${status.model}）` : "未配置（降级模式）"}
      </span>
      {policyVersion && <span style={{ opacity: 0.5 }}>·</span>}
      {policyVersion && <span>策略版本 {policyVersion}</span>}
      <span style={{ opacity: 0.5 }}>·</span>
      <span>合成脱敏数据</span>
    </div>
  );
}
