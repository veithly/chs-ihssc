"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarIcon,
  ExclamationTriangleIcon,
  IdCardIcon,
  LockClosedIcon,
  ReloadIcon,
  CheckIcon,
} from "@radix-ui/react-icons";
import { Badge, Callout } from "@radix-ui/themes";
import { MUTATIONS, type MutationType } from "@/lib/types";
import { StateBadge } from "./StateBadge";
import { MetaGrid } from "./MetaGrid";

interface Row {
  id: string;
  row_index: number;
  person_token: string;
  catalog_code: string;
  service_date: string;
  access_policy: string;
}

interface ReleaseLite {
  id: string;
  title: string;
  publisher: string;
  domain: string;
  version_label: string;
  record_count: number;
  created_at: string;
  release_date: string;
  state:
    | "待发布"
    | "检查中"
    | "纠错候选"
    | "隔离"
    | "可发布"
    | "需审批"
    | "检查失败";
}

const ICONS: Record<MutationType, React.ReactNode> = {
  wrong_code: <ExclamationTriangleIcon />,
  future_date: <CalendarIcon />,
  identity_conflict: <IdCardIcon />,
  access_denied: <LockClosedIcon />,
  none: null,
};

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function previewFor(mutation: MutationType, row: Row, releaseDate: string) {
  switch (mutation) {
    case "wrong_code":
      return { field: "catalog_code", value: "I1O", badge: "错误编码" };
    case "future_date":
      return { field: "service_date", value: addDays(releaseDate, 7), badge: "未来日期" };
    case "identity_conflict":
      return {
        field: "person_token",
        value: row.person_token.slice(0, 6) + "*******0001",
        badge: "身份冲突",
      };
    case "access_denied":
      return { field: "access_policy", value: row.access_policy, badge: "权限拒绝" };
    default:
      return { field: "", value: "", badge: "" };
  }
}

export function ReleaseGate({
  release,
  rows,
  highlightIndex,
  providerConfigured,
}: {
  release: ReleaseLite;
  rows: Row[];
  highlightIndex: number;
  providerConfigured: boolean;
}) {
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState(
    Math.min(highlightIndex, rows.length - 1),
  );
  const [mutation, setMutation] = useState<MutationType>("future_date");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = rows[selectedIndex];
  const preview = previewFor(mutation, selected, release.release_date);
  const consequence =
    MUTATIONS.find((m) => m.id === mutation)?.consequence ?? "";

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/release-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseId: release.id,
          rowId: selected.id,
          mutationType: mutation,
        }),
      });
      const data = await res.json();
      if (data.runId) {
        router.push(`/release/${release.id}/result`);
        router.refresh();
      } else {
        setError(data.message ?? "通行检查失败。");
        setRunning(false);
      }
    } catch (e) {
      setError(`请求失败：${e instanceof Error ? e.message : String(e)}`);
      setRunning(false);
    }
  }

  const cellValue = (row: Row, field: string, original: string) => {
    if (row.row_index === selected.row_index && preview.field === field) {
      return (
        <span style={{ color: "var(--gate-accent)", fontWeight: 600 }}>{preview.value}</span>
      );
    }
    return original;
  };

  return (
    <main
      data-visual-lane="regulated-product-release-gate"
      data-hero-composition="single-row-release-gate"
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: "16px 24px 8px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.45fr) minmax(0, 1fr)",
        gap: 20,
        alignItems: "start",
      }}
      className="gate-grid"
    >
      {/* LEFT: release + data preview */}
      <section className="gate-card" data-release-card style={{ padding: 22 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <span
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "var(--gate-accent-soft)",
              color: "var(--gate-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: 22,
            }}
            aria-hidden
          >
            ▤
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--gate-ink-soft)" }}>数据集发布</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 2 }}>
              <h1 className="mono" style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>
                {release.id}
              </h1>
              <StateBadge state={release.state} size="2" />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <MetaGrid release={release as never} />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            margin: "20px 0 10px",
          }}
        >
          <strong style={{ fontSize: 15 }}>待发布数据预览（抽样）</strong>
          <span style={{ fontSize: 13, color: "var(--gate-ink-soft)" }}>共 {rows.length} 条</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ color: "var(--gate-ink-soft)", textAlign: "left" }}>
                <th style={{ padding: "10px 10px", fontWeight: 500, width: 36 }}></th>
                <th style={{ padding: "10px 10px", fontWeight: 500 }}>人员标识</th>
                <th style={{ padding: "10px 10px", fontWeight: 500 }}>病种编码</th>
                <th style={{ padding: "10px 10px", fontWeight: 500 }}>服务日期</th>
                <th style={{ padding: "10px 10px", fontWeight: 500 }}>访问策略</th>
                <th style={{ padding: "10px 10px", fontWeight: 500 }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSel = r.row_index === selected.row_index;
                return (
                  <tr
                    key={r.id}
                    data-row-highlight={isSel ? "true" : undefined}
                    onClick={() => setSelectedIndex(r.row_index)}
                    className={isSel ? "gate-row-active" : undefined}
                    style={{
                      cursor: "pointer",
                      borderTop: "1px solid var(--gate-border)",
                    }}
                  >
                    <td style={{ padding: "11px 10px" }}>
                      <span
                        aria-hidden
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          border: `2px solid ${isSel ? "var(--gate-accent)" : "#c2ccdd"}`,
                          background: isSel ? "var(--gate-accent)" : "#fff",
                          display: "inline-block",
                        }}
                      />
                    </td>
                    <td className="mono" style={{ padding: "11px 10px" }}>{r.person_token}</td>
                    <td className="mono" style={{ padding: "11px 10px" }}>
                      {cellValue(r, "catalog_code", r.catalog_code)}
                    </td>
                    <td className="mono" style={{ padding: "11px 10px" }}>
                      {cellValue(r, "service_date", r.service_date)}
                    </td>
                    <td style={{ padding: "11px 10px", color: "var(--gate-ink-soft)" }}>
                      {r.access_policy}
                    </td>
                    <td style={{ padding: "11px 10px" }}>
                      <span style={{ color: "var(--gate-amber)", fontSize: 13 }}>待检查</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* RIGHT: gate settings */}
      <aside className="gate-card" style={{ padding: 22, position: "sticky", top: 76 }}>
        <strong style={{ fontSize: 16 }}>通行检查设置</strong>
        <div style={{ fontSize: 13, color: "var(--gate-ink-soft)", margin: "14px 0 8px" }}>
          选中记录（第 {selected.row_index + 1} 条）
        </div>

        <div className="gate-card-flat" style={{ overflow: "hidden" }}>
          {[
            { label: "人员标识", field: "person_token", value: selected.person_token },
            { label: "病种编码", field: "catalog_code", value: selected.catalog_code },
            { label: "服务日期", field: "service_date", value: selected.service_date },
            { label: "访问策略", field: "access_policy", value: selected.access_policy },
          ].map((f, i) => {
            const mutated = preview.field === f.field;
            const shown = mutated && preview.value ? preview.value : f.value;
            return (
              <div
                key={f.field}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "11px 14px",
                  borderTop: i === 0 ? "none" : "1px solid var(--gate-border)",
                }}
              >
                <span style={{ fontSize: 13, color: "var(--gate-ink-soft)" }}>{f.label}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="mono"
                    style={{
                      fontSize: 13.5,
                      fontWeight: mutated ? 600 : 500,
                      color: mutated ? "var(--gate-accent)" : "var(--gate-ink)",
                    }}
                  >
                    {shown}
                  </span>
                  {mutated && (
                    <Badge color="amber" variant="soft" size="1" data-consequence-preview>
                      {preview.badge}
                    </Badge>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 13, color: "var(--gate-ink-soft)", margin: "18px 0 8px" }}>
          可能的变更类型
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {MUTATIONS.map((m) => {
            const sel = mutation === m.id;
            return (
              <button
                key={m.id}
                type="button"
                className="chip"
                data-mutation-chip={m.id}
                data-selected={sel}
                aria-pressed={sel}
                title={m.hint}
                onClick={() => setMutation(m.id)}
                style={{ justifyContent: "space-between" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {ICONS[m.id]} {m.label}
                </span>
                {sel && <CheckIcon />}
              </button>
            );
          })}
        </div>

        <div className="consequence" data-consequence-strip style={{ marginTop: 16 }}>
          {consequence}
        </div>

        {!providerConfigured && (
          <Callout.Root color="amber" size="1" style={{ marginTop: 12 }}>
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              未发现 Provider 凭证，运行将进入降级模式并写入「检查失败」（不会伪造成功）。
            </Callout.Text>
          </Callout.Root>
        )}

        {error && (
          <Callout.Root color="red" size="1" style={{ marginTop: 12 }}>
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}

        <button
          type="button"
          className="cta-primary"
          data-cta-primary
          onClick={run}
          disabled={running}
          style={{ marginTop: 16 }}
        >
          {running ? (
            <>
              <ReloadIcon className="spin" /> 检查中…
            </>
          ) : (
            <>通行检查</>
          )}
        </button>
        <div
          aria-live="polite"
          style={{
            textAlign: "center",
            fontSize: 12.5,
            color: "var(--gate-ink-soft)",
            marginTop: 10,
          }}
        >
          {running
            ? "Agent 正在 observe / plan / 调用工具 / 写入状态…"
            : "执行通行检查以识别阻断原因与处置建议"}
        </div>
      </aside>
    </main>
  );
}
