"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Callout } from "@radix-ui/themes";
import { ExclamationTriangleIcon, ReloadIcon, UploadIcon } from "@radix-ui/react-icons";

const SAMPLE = `item_code,item_name,price_date,procurement_channel,region,unit_price
YP-AXL-001,阿莫西林胶囊 0.25g*24粒,2026-06-18,集采中选-省平台,上海市,6.91
YP-AMT-OO2,阿托伐他汀钙片 20mg*14片,2026-06-19,省级挂网,上海市,18.90
HC-STN-901,冠脉药物洗脱支架,2026-06-20,集采中选-省平台,广东省,742.00
HC-LNS-902,人工晶体 单焦点,2026-07-30,省级挂网,北京市,780.00
YP-UNKNOWN-999,未映射价格项目,2026-06-17,阳光采购,浙江省,39.80`;

export function ImportForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsv(await f.text());
    if (!title) setTitle(f.name.replace(/\.(csv|txt)$/i, ""));
  }

  async function submit() {
    if (busy) return;
    if (!csv.trim()) {
      setError("请粘贴 CSV 或选择文件。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, csv }),
      });
      const data = await res.json();
      if (data.ok && data.releaseId) {
        router.push(`/release/${data.releaseId}`);
        router.refresh();
      } else {
        setError(data.message ?? "导入失败。");
        setBusy(false);
      }
    } catch (e) {
      setError(`请求失败：${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  return (
    <div className="import-grid">
      <section className="gate-card import-main">
        <div className="import-head">
          <div>
            <span className="import-kicker mono">SOURCE INTAKE · 采集箱</span>
            <strong className="import-title">导入价格批次</strong>
          </div>
          <span className="import-tag mono">CSV · 最多 500 行</span>
        </div>
        <p className="import-lead">
          粘贴 CSV 或上传文件，创建一个新的价格治理批次，并用同一套价格目录与采购渠道策略让智能体逐行监测。请仅导入合成 / 脱敏数据，切勿上传真实敏感信息。
        </p>

        <label className="import-label" htmlFor="import-title">批次名称</label>
        <input
          id="import-title"
          className="cell-input"
          style={{ minHeight: 40 }}
          value={title}
          placeholder="例如：省平台集采落地抽检批次"
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="import-csv-head">
          <label className="import-label">CSV 内容</label>
          <div className="import-csv-actions">
            <button type="button" className="chip" style={{ minHeight: 32, fontSize: 12.5 }} onClick={() => setCsv(SAMPLE)}>
              填入示例
            </button>
            <button type="button" className="chip" style={{ minHeight: 32, fontSize: 12.5 }} onClick={() => fileRef.current?.click()}>
              <UploadIcon /> 选择文件
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={onFile} />
          </div>
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={SAMPLE}
          spellCheck={false}
          className="mono import-csv"
        />

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
          data-import-submit
          onClick={submit}
          disabled={busy}
        >
          {busy ? (
            <>
              <ReloadIcon className="spin" /> 创建中
            </>
          ) : (
            <>解析并创建价格批次</>
          )}
        </button>
      </section>

      <aside className="gate-card import-side">
        <div className="import-side-head">
          <strong>列说明</strong>
          <span className="import-side-tag mono">schema</span>
        </div>
        <dl className="import-cols">
          {[
            ["item_code", "医保项目编码", "药品或医用耗材统一编码（必填）"],
            ["item_name", "药品耗材名称", "目录标准名称或待标化名称（必填）"],
            ["price_date", "价格日期", "YYYY-MM-DD"],
            ["procurement_channel", "采购渠道", "如：集采中选-省平台 / 省级挂网"],
            ["region", "地区", "价格发生地区"],
            ["unit_price", "单价", "人民币元，支持小数"],
          ].map(([key, label, desc], i) => (
            <div key={key} className="import-col-row" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-soft)" }}>
              <dt>
                <span className="mono import-col-key">{key}</span>
                <span className="import-col-label">{label}</span>
              </dt>
              <dd>{desc}</dd>
            </div>
          ))}
        </dl>
        <p className="import-side-foot">
          支持中文或英文表头；最多 500 行。导入后可在批次页继续自由编辑任意单元格再重跑治理。
        </p>
      </aside>

      <style>{`
        .import-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }
        .import-main,
        .import-side {
          padding: 24px;
        }
        .import-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }
        .import-kicker {
          display: block;
          font-size: 10.5px;
          color: var(--ink-3);
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .import-title {
          display: block;
          font-size: 18px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: var(--gate-ink);
        }
        .import-tag {
          font-size: 11px;
          color: var(--ink-3);
          padding: 4px 9px;
          border-radius: 6px;
          background: var(--surface-sunken);
          font-weight: 500;
          letter-spacing: 0.04em;
        }
        .import-lead {
          font-size: 13px;
          color: var(--gate-ink-soft);
          margin: 6px 0 18px;
          line-height: 1.65;
          max-width: 60ch;
        }
        .import-label {
          display: block;
          font-size: 11px;
          color: var(--ink-3);
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-weight: 600;
          margin: 16px 0 6px;
        }
        .import-csv-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 16px 0 6px;
          gap: 8px;
        }
        .import-csv-actions {
          display: flex;
          gap: 6px;
        }
        .import-csv {
          width: 100%;
          min-height: 240px;
          padding: 12px;
          border: 1px solid var(--gate-border);
          border-radius: 10px;
          font-size: 12.5px;
          line-height: 1.6;
          resize: vertical;
          background: var(--surface-subtle);
          color: var(--gate-ink);
          outline: none;
          transition: border-color 140ms var(--ease-soft), background 140ms var(--ease-soft);
        }
        .import-csv:focus {
          border-color: var(--gate-accent);
          background: var(--bg-elevated);
          box-shadow: 0 0 0 3px rgba(40, 65, 214, 0.12);
        }
        .import-main .cta-primary {
          margin-top: 16px;
          max-width: 280px;
        }

        .import-side-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 12px;
        }
        .import-side-head strong {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .import-side-tag {
          font-size: 10.5px;
          color: var(--ink-3);
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--surface-sunken);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .import-cols {
          margin: 0;
          border: 1px solid var(--gate-border);
          border-radius: 10px;
          overflow: hidden;
          background: var(--bg-elevated);
        }
        .import-col-row {
          padding: 10px 12px;
        }
        .import-col-row dt {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-bottom: 4px;
        }
        .import-col-key {
          font-size: 11.5px;
          color: var(--gate-accent-strong);
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .import-col-label {
          font-size: 12.5px;
          color: var(--gate-ink);
          font-weight: 500;
        }
        .import-col-row dd {
          margin: 0;
          font-size: 12px;
          color: var(--gate-ink-soft);
          line-height: 1.5;
        }
        .import-side-foot {
          font-size: 11.5px;
          color: var(--ink-3);
          line-height: 1.6;
          margin-top: 12px;
        }

        @media (max-width: 820px) {
          .import-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
