export type WorkspaceRawRow = Record<string, string>;

export interface ParsedWorkspaceCsv {
  columns: string[];
  rows: WorkspaceRawRow[];
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseWorkspaceCsv(csv: string, maxRows = 600): ParsedWorkspaceCsv {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("至少需要表头和 1 行数据。");
  }

  const columns = splitLine(lines[0]).map((c, i) => c || `未命名列${i + 1}`);
  if (columns.length < 2) {
    throw new Error("表头列数过少，无法识别价格治理字段。");
  }

  const rows: WorkspaceRawRow[] = [];
  for (let i = 1; i < lines.length && rows.length < maxRows; i += 1) {
    const cells = splitLine(lines[i]);
    const row: WorkspaceRawRow = {};
    columns.forEach((column, idx) => {
      row[column] = cells[idx] ?? "";
    });
    if (Object.values(row).some((v) => String(v).trim())) rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error("没有读到有效数据行。");
  }

  return { columns, rows };
}
