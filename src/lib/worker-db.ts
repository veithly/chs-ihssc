import "server-only";

type Row = Record<string, unknown>;
type Params = Record<string, unknown>;

class InMemoryDatabase {
  private tables: Record<string, Row[]> = {};
  private nextId = 1;

  exec(_sql: string): void {
    // CREATE TABLE IF NOT EXISTS is a no-op for in-memory
  }

  prepare<T extends Row[]>(sql: string): InMemoryStatement {
    const normalized = sql.trim().replace(/\s+/g, " ");
    return new InMemoryStatement(this, normalized);
  }

  getTable(name: string): Row[] {
    if (!this.tables[name]) {
      this.tables[name] = [];
    }
    return this.tables[name];
  }

  insert(table: string, row: Row): void {
    const rows = this.getTable(table);
    const id = String(this.nextId++);
    rows.push({ ...row, id });
  }

  select(
    table: string,
    where?: { column: string; value: unknown },
    orderBy?: { column: string; direction: "ASC" | "DESC" },
    limit?: number,
  ): Row[] {
    let rows = this.getTable(table);
    if (where) {
      rows = rows.filter((r) => r[where.column] === where.value);
    }
    if (orderBy) {
      rows.sort((a, b) => {
        const aVal = a[orderBy.column];
        const bVal = b[orderBy.column];
        if (aVal === bVal) return 0;
        if (aVal === undefined || aVal === null) return 1;
        if (bVal === undefined || bVal === null) return -1;
        const cmp = String(aVal).localeCompare(String(bVal));
        return orderBy.direction === "DESC" ? -cmp : cmp;
      });
    }
    if (limit !== undefined) {
      rows = rows.slice(0, limit);
    }
    return rows;
  }

  count(table: string, where?: { column: string; value: unknown }): number {
    if (where) {
      return this.getTable(table).filter((r) => r[where.column] === where.value).length;
    }
    return this.getTable(table).length;
  }
}

class InMemoryStatement {
  constructor(private db: InMemoryDatabase, private sql: string) {}

  all(_params?: Params): Row[] {
    // Simple SQL parser for the queries used in this app
    const upper = this.sql.toUpperCase();

    if (upper.startsWith("SELECT COUNT(")) {
      const match = this.sql.match(/COUNT\(\*\)\s+FROM\s+(\w+)/i);
      if (match) {
        const count = this.db.count(match[1]);
        return [{ "COUNT(*)": count }];
      }
    }

    if (upper.startsWith("SELECT * FROM")) {
      const match = this.sql.match(/FROM\s+(\w+)/i);
      if (match) {
        const table = match[1];
        let rows = this.db.select(table);

        // WHERE clause
        const whereMatch = this.sql.match(/WHERE\s+(\w+)\s*=\s*:(\w+)/i);
        if (whereMatch) {
          const column = whereMatch[1];
          const paramName = whereMatch[2];
          const paramValue = _params?.[paramName];
          rows = this.db.select(table, { column, value: paramValue });
        }

        // ORDER BY
        const orderMatch = this.sql.match(/ORDER BY\s+(\w+)\s+(ASC|DESC)/i);
        if (orderMatch) {
          const orderBy = { column: orderMatch[1], direction: orderMatch[2] as "ASC" | "DESC" };
          rows = this.db.select(table, undefined, orderBy);
        }

        // LIMIT
        const limitMatch = this.sql.match(/LIMIT\s+(\d+)/i);
        if (limitMatch) {
          rows = rows.slice(0, parseInt(limitMatch[1], 10));
        }

        return rows;
      }
    }

    return [];
  }

  get(_params?: Params): Row | null {
    const rows = this.all(_params);
    return rows[0] ?? null;
  }

  run(_params?: Params): { rowsAffected: number; changes: number } {
    // Parse INSERT statements
    const insertMatch = this.sql.match(
      /INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
    );
    if (insertMatch) {
      const table = insertMatch[1];
      const columns = insertMatch[2].split(",").map((c) => c.trim());
      const values = insertMatch[3].split(",").map((v) => {
        const trimmed = v.trim();
        if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
          return trimmed.slice(1, -1);
        }
        if (trimmed === "NULL") return null;
        if (trimmed === "TRUE") return true;
        if (trimmed === "FALSE") return false;
        if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
        if (/^\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
        return trimmed;
      });

      const row: Row = {};
      columns.forEach((col, idx) => {
        row[col] = values[idx];
      });

      // Handle :param style placeholders
      if (_params) {
        Object.entries(_params).forEach(([key, value]) => {
          row[key] = value;
        });
      }

      this.db.insert(table, row);
      return { rowsAffected: 1, changes: 1 };
    }

    return { rowsAffected: 0, changes: 0 };
  }
}

let dbInstance: InMemoryDatabase | null = null;

export function open(): InMemoryDatabase {
  if (!dbInstance) {
    dbInstance = new InMemoryDatabase();
  }
  return dbInstance;
}

export function getDb(): InMemoryDatabase {
  return open();
}
