import type { ProcedureHandler } from "../../contracts";
import type { TableData } from "./types";

function parseCsv(text: string): TableData {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const columns = parseLine(lines[0]!).map((c, i) => c || `col_${i + 1}`);
  const rows = lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      row[col] = cells[i] ?? "";
    });
    return row;
  });
  return { columns, rows };
}

/** Pure CSV → table normalizer (no filesystem, no eval). */
export function normalizeCsv(csvText: string): TableData {
  return parseCsv(String(csvText ?? ""));
}

export const normalize_csv: ProcedureHandler = (input) => {
  const text =
    typeof input.csv === "string"
      ? input.csv
      : typeof input.text === "string"
        ? input.text
        : typeof input.content === "string"
          ? input.content
          : "";
  const table = normalizeCsv(text);
  return { ok: true, output: { table, rowCount: table.rows.length, columnCount: table.columns.length } };
};
