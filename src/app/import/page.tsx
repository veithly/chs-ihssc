import { AppHeader, Breadcrumb } from "@/components/AppHeader";
import { ImportForm } from "@/components/ImportForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="gate-shell">
      <AppHeader active="补充来源" />
      <Breadcrumb items={["价序", "采集箱"]} />
      <main className="import-shell">
        <header className="import-page-head">
          <div className="agent-eyebrow">
            <span className="mono">采集箱 · 补来源</span>
          </div>
          <h1 className="import-page-title">补一批来源</h1>
          <p className="import-page-lead">
            表格只是补来源的一种方式。真实使用里，这里可以接省平台、院端回传、投诉线索和人工补证材料。
          </p>
        </header>
        <ImportForm />
      </main>
    </div>
  );
}
