import { NextResponse } from "next/server";
import { createReleaseWithRows } from "@/lib/seed";
import { PRICE_OPTIONS, PROCUREMENT_CHANNELS, REGION_OPTIONS, type FixtureRow } from "@/lib/fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CHANNEL = PROCUREMENT_CHANNELS[1];
const DEFAULT_REGION = REGION_OPTIONS[1];
const DEFAULT_PRICE = PRICE_OPTIONS[0];

// Header aliases (English + Chinese) → canonical field.
const ALIASES: Record<string, keyof FixtureRow> = {
  item_code: "item_code",
  医保项目编码: "item_code",
  项目编码: "item_code",
  code: "item_code",
  item_name: "item_name",
  药品耗材名称: "item_name",
  药品或耗材名称: "item_name",
  项目名称: "item_name",
  name: "item_name",
  price_date: "price_date",
  价格日期: "price_date",
  监测日期: "price_date",
  date: "price_date",
  procurement_channel: "procurement_channel",
  采购渠道: "procurement_channel",
  价格渠道: "procurement_channel",
  channel: "procurement_channel",
  region: "region",
  地区: "region",
  省份: "region",
  unit_price: "unit_price",
  单价: "unit_price",
  价格: "unit_price",
  price: "unit_price",
};

function splitLine(line: string): string[] {
  // Minimal CSV: comma-separated, optional double quotes, no embedded newlines.
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(csv: string): { rows: FixtureRow[]; error?: string } {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { rows: [], error: "至少需要表头 + 1 行数据。" };
  }
  const header = splitLine(lines[0]).map((h) => h.toLowerCase());
  const fieldByCol = header.map((h) => ALIASES[h] ?? ALIASES[h.replace(/\s/g, "")]);
  if (!fieldByCol.includes("item_code") || !fieldByCol.includes("item_name")) {
    return {
      rows: [],
      error: "表头需至少包含 item_code(医保项目编码) 与 item_name(药品/耗材名称) 列。",
    };
  }

  const rows: FixtureRow[] = [];
  for (let i = 1; i < lines.length && rows.length < 500; i += 1) {
    const cells = splitLine(lines[i]);
    const rec: FixtureRow = {
      item_code: "",
      item_name: "",
      price_date: "",
      procurement_channel: DEFAULT_CHANNEL,
      region: DEFAULT_REGION,
      unit_price: DEFAULT_PRICE,
    };
    fieldByCol.forEach((field, idx) => {
      if (!field) return;
      const v = (cells[idx] ?? "").trim();
      if (v) rec[field] = v;
    });
    rows.push(rec);
  }
  return { rows };
}

export async function POST(req: Request) {
  let body: { title?: string; csv?: string };
  try {
    body = (await req.json()) as { title?: string; csv?: string };
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式不正确，请重新提交。" }, { status: 400 });
  }
  if (!body.csv || !body.csv.trim()) {
    return NextResponse.json({ ok: false, message: "缺少表格内容。" }, { status: 400 });
  }

  const { rows, error } = parseCsv(body.csv);
  if (error) {
    return NextResponse.json({ ok: false, message: error }, { status: 400 });
  }

  const { id } = createReleaseWithRows({
    title: body.title?.trim() || "导入价格批次",
    rows,
  });

  return NextResponse.json({ ok: true, releaseId: id, rows: rows.length });
}
