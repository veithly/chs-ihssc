import { NextResponse } from "next/server";
import { getRow, updateRow } from "@/lib/repo";
import { EDITABLE_FIELDS, type EditableField } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator inline free-edit: PATCH any subset of editable fields on one row.
export async function PATCH(req: Request) {
  let body: { rowId?: string; patch?: Record<string, unknown> };
  try {
    body = (await req.json()) as { rowId?: string; patch?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ ok: false, message: "请求体不是合法 JSON。" }, { status: 400 });
  }
  if (!body.rowId || !body.patch) {
    return NextResponse.json({ ok: false, message: "缺少 rowId 或 patch。" }, { status: 400 });
  }
  if (!getRow(body.rowId)) {
    return NextResponse.json({ ok: false, message: "未找到该数据行。" }, { status: 404 });
  }

  const patch: Partial<Record<EditableField, string>> = {};
  for (const f of EDITABLE_FIELDS) {
    if (f in body.patch) patch[f] = String(body.patch[f] ?? "");
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "没有可更新的字段。" }, { status: 400 });
  }

  const row = updateRow(body.rowId, patch);
  return NextResponse.json({ ok: true, row });
}
