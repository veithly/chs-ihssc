"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ExclamationTriangleIcon,
  ReloadIcon,
  Pencil1Icon,
  UploadIcon,
} from "@radix-ui/react-icons";
import { Badge, Callout } from "@radix-ui/themes";
import { StateBadge } from "./StateBadge";
import { MetaGrid } from "./MetaGrid";
import { ResetSampleButton } from "./ClientButtons";

interface Row {
  id: string;
  row_index: number;
  item_code: string;
  item_name: string;
  price_date: string;
  procurement_channel: string;
  region: string;
  unit_price: string;
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
    | "待治理"
    | "监测中"
    | "纠错候选"
    | "异常处置"
    | "可落地"
    | "需核验"
    | "检查失败";
}

type EditableField =
  | "item_code"
  | "item_name"
  | "price_date"
  | "procurement_channel"
  | "region"
  | "unit_price";

function EditableCell({
  value,
  field,
  rowId,
  type = "text",
  options,
  onSaved,
}: {
  value: string;
  field: EditableField;
  rowId: string;
  type?: "text" | "date";
  options?: string[];
  onSaved: (field: EditableField, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  async function commit() {
    setEditing(false);
    if (draft === value) return;
    onSaved(field, draft);
    await fetch("/api/row", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId, patch: { [field]: draft } }),
    }).catch(() => {});
  }

  if (editing) {
    const listId = options ? `dl-${field}` : undefined;
    return (
      <>
        <input
          autoFocus
          type={type}
          list={listId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          className="mono cell-input"
        />
        {options && (
          <datalist id={listId}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        )}
      </>
    );
  }

  return (
    <button
      type="button"
      className="cell-edit"
      data-edit-field={field}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title="点击编辑"
    >
      <span className={field === "item_code" || field === "unit_price" || field === "price_date" ? "mono" : undefined}>
        {value || <span style={{ color: "var(--gate-red)" }}>（空）</span>}
      </span>
      <Pencil1Icon className="cell-pencil" />
    </button>
  );
}

export function ReleaseGate({
  release,
  rows: initialRows,
  providerConfigured,
  isSample,
  regionOptions,
  unitPriceOptions,
  channelOptions,
}: {
  release: ReleaseLite;
  rows: Row[];
  providerConfigured: boolean;
  isSample: boolean;
  regionOptions: string[];
  unitPriceOptions: string[];
  channelOptions: string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [edited, setEdited] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchRow(rowIndex: number, field: EditableField, value: string) {
    setRows((prev) =>
      prev.map((r) => (r.row_index === rowIndex ? { ...r, [field]: value } : r)),
    );
    setEdited((prev) => new Set(prev).add(rowIndex));
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/release-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId: release.id }),
      });
      const data = await res.json();
      if (data.runId) {
        router.push(`/release/${release.id}/result`);
        router.refresh();
      } else {
        setError(data.message ?? "价格治理监测失败。");
        setRunning(false);
      }
    } catch (e) {
      setError(`请求失败：${e instanceof Error ? e.message : String(e)}`);
      setRunning(false);
    }
  }

  const optsFor = (field: EditableField): string[] | undefined => {
    if (field === "region") return regionOptions;
    if (field === "unit_price") return unitPriceOptions;
    if (field === "procurement_channel") return channelOptions;
    return undefined;
  };

  const agentPlanSteps = [
    "读取价格明细与目录快照",
    "判断本批先核哪些风险",
    "核对标化、集采落地、参考价和渠道",
    "写入纠错、核验和异常处置对象",
    "复核结果并保存留痕",
  ];

  return (
    <main
      data-visual-lane="medical-price-governance-agent"
      data-hero-composition="price-batch-governance"
      className="release-shell"
    >
      <section className="gate-card release-card" data-release-card>
        <header className="release-card-head">
          <div className="release-card-id">
            <span className="release-card-mark" aria-hidden>价</span>
            <div>
              <div className="release-card-kicker mono">
                价格治理批次 · {release.title}
              </div>
              <div className="release-card-title-row">
                <h1 className="mono release-card-id-text">{release.id}</h1>
                <StateBadge state={release.state} size="2" />
                {isSample && (
                  <Badge color="gray" variant="soft" size="1" radius="full">
                    公开样例 · 可自由编辑
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="release-card-actions">
            <Link href="/import" className="chip" style={{ textDecoration: "none" }}>
              <UploadIcon /> 导入价格批次
            </Link>
            {isSample && <ResetSampleButton />}
          </div>
        </header>

        <div style={{ marginTop: 18 }}>
          <MetaGrid release={release as never} />
        </div>

        <div className="release-rows-head">
          <strong>
            待治理价格明细
            <span className="mono" style={{ color: "var(--ink-3)", fontWeight: 500, marginLeft: 8 }}>
              抽样 {rows.length} 行 / 共 {release.record_count.toLocaleString("zh-CN")} 条
            </span>
          </strong>
          <span className="release-rows-hint mono">
            价格异常自然分布于行内 · 点击任意单元格可编辑后重扫
          </span>
        </div>

        <div className="batch-scroll" data-batch-table>
          <table className="batch-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>项目编码</th>
                <th>药品 / 耗材名称</th>
                <th>价格日期</th>
                <th>采购渠道</th>
                <th>地区</th>
                <th>单价（元）</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-row-edited={edited.has(r.row_index) ? "true" : undefined}>
                  <td className="mono" style={{ color: "var(--gate-ink-soft)" }}>
                    {r.row_index + 1}
                    {edited.has(r.row_index) && (
                      <span className="edited-dot" title="已编辑" />
                    )}
                  </td>
                  {(
                    [
                      ["item_code", "text"],
                      ["item_name", "text"],
                      ["price_date", "date"],
                      ["procurement_channel", "text"],
                      ["region", "text"],
                      ["unit_price", "text"],
                    ] as [EditableField, "text" | "date"][]
                  ).map(([field, type]) => (
                    <td key={field}>
                      <EditableCell
                        value={r[field]}
                        field={field}
                        rowId={r.id}
                        type={type}
                        options={optsFor(field)}
                        onSaved={(f, v) => patchRow(r.row_index, f, v)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!providerConfigured && (
          <Callout.Root color="amber" size="1" style={{ marginTop: 14 }}>
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              未发现智能研判配置，本次只保留可确定核查并写入「检查失败」（不会伪造成功）。
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

        <div className="release-run-row">
          <button
            type="button"
            className="cta-primary"
            data-cta-primary
            onClick={run}
            disabled={running}
          >
            {running ? (
              <>
                <ReloadIcon className="spin" /> 监测中
              </>
            ) : (
              <>发起价格治理 · 整批 {rows.length} 行</>
            )}
          </button>
          <div className="release-run-trace" aria-live="polite">
            <div className="release-run-trace-head">
              <span className="mono">核查步骤</span>
              <span className={`release-run-status ${running ? "running" : "idle"}`}>
                {running ? "进行中" : "待开始"}
              </span>
            </div>
            <ol className="release-run-steps">
              {agentPlanSteps.map((step, i) => (
                <li
                  key={step}
                  className={`release-run-step ${running ? "active" : ""}`}
                  style={{ animationDelay: running ? `${i * 90}ms` : undefined }}
                >
                  <span className="release-run-step-index mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="release-run-step-label">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </main>
  );
}
