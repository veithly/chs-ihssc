import { NextResponse } from "next/server";
import { parseWorkspaceCsv } from "@/lib/workspace/csv";
import { DEMO_SOURCES, type DemoSourceId } from "@/lib/workspace/demoSources";
import {
  createWorkspaceFromDemoSource,
  createWorkspaceFromUpload,
} from "@/lib/workspace/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    kind?: "demo" | "upload";
    sourceId?: DemoSourceId;
    title?: string;
    fileName?: string;
    csv?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式不正确，请重新提交。" }, { status: 400 });
  }

  try {
    if (body.kind === "demo") {
      const sourceId =
        DEMO_SOURCES.some((s) => s.id === body.sourceId) ? body.sourceId! : "demo-price-sheet";
      const snapshot = createWorkspaceFromDemoSource(sourceId);
      return NextResponse.json({ ok: true, snapshot });
    }

    const fileName = body.fileName?.trim() || "upload.csv";
    if (/\.xlsx$/i.test(fileName)) {
      return NextResponse.json(
        {
          ok: false,
          code: "xlsx_reserved",
          message: "当前演示先支持 CSV 表格，电子表格入口已预留。请先另存为 CSV，或使用演示数据源。",
        },
        { status: 400 },
      );
    }
    if (!body.csv?.trim()) {
      return NextResponse.json({ ok: false, message: "缺少表格内容。" }, { status: 400 });
    }
    const parsed = parseWorkspaceCsv(body.csv);
    const snapshot = createWorkspaceFromUpload({
      title: body.title?.trim() || "上传价格表",
      fileName,
      columns: parsed.columns,
      rows: parsed.rows,
    });
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "数据源接入失败。" },
      { status: 400 },
    );
  }
}
