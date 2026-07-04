import { NextResponse } from "next/server";
import { ingestUploadedPolicyDocument } from "@/lib/policy/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB：政策公告/附件足够，防误传大包

// POST /api/workspace/policy-upload（multipart/form-data，字段 file，可选 title）
// 内网无外网时的政策入口：上传 PDF/CSV/XLSX/DOCX → policy_artifact 留痕（hash 去重）。
// CSV 自动解析结构化事实建议；生效仍必须走人审确认（与外网抓取链路一致）。
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, message: "请用 multipart/form-data 上传，字段名 file。" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "缺少文件（字段名 file）。" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ ok: false, message: "文件为空。" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, message: `文件超过 ${MAX_BYTES / 1024 / 1024}MB 上限。` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const title = typeof form.get("title") === "string" ? String(form.get("title")) : undefined;
  const result = ingestUploadedPolicyDocument({ fileName: file.name, buffer, title });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
