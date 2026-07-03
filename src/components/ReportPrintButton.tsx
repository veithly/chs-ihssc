"use client";

export function ReportPrintButton() {
  return (
    <button
      type="button"
      className="report-print-btn"
      data-report-print
      onClick={() => window.print()}
    >
      打印 / 存为 PDF
    </button>
  );
}
