import type { ProcedureHandler } from "../../contracts";
import { asTable, type TableData } from "./types";

export function deduplicateRows(
  tableInput: unknown,
  keys?: string[],
): { table: TableData; removed: number } {
  const table = asTable(tableInput);
  const keyCols = keys?.length ? keys : table.columns;
  const seen = new Set<string>();
  const rows = [];
  let removed = 0;
  for (const row of table.rows) {
    const sig = JSON.stringify(keyCols.map((k) => row[k]));
    if (seen.has(sig)) {
      removed += 1;
      continue;
    }
    seen.add(sig);
    rows.push(row);
  }
  return { table: { columns: table.columns, rows }, removed };
}

export const deduplicate_rows: ProcedureHandler = (input) => {
  const keys = Array.isArray(input.keys) ? input.keys.map(String) : undefined;
  const result = deduplicateRows(input.table ?? input, keys);
  return { ok: true, output: result };
};
