export type TableRow = Record<string, unknown>;

export type TableData = {
  columns: string[];
  rows: TableRow[];
};

export function asTable(input: unknown): TableData {
  if (!input || typeof input !== "object") {
    return { columns: [], rows: [] };
  }
  const obj = input as Record<string, unknown>;
  if (Array.isArray(obj.rows) && Array.isArray(obj.columns)) {
    return {
      columns: obj.columns.map(String),
      rows: obj.rows as TableRow[],
    };
  }
  if (Array.isArray(input)) {
    const rows = input as TableRow[];
    const colSet = new Set<string>();
    for (const row of rows) {
      if (row && typeof row === "object") {
        for (const k of Object.keys(row)) colSet.add(k);
      }
    }
    return { columns: [...colSet], rows };
  }
  return { columns: [], rows: [] };
}
