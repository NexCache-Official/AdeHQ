import type { ProcedureHandler } from "../../contracts";
import { asTable } from "./types";

export function detectMissingValues(tableInput: unknown): {
  totalCells: number;
  missingCells: number;
  byColumn: Record<string, { missing: number; rate: number }>;
  rowIndexesWithMissing: number[];
} {
  const table = asTable(tableInput);
  const byColumn: Record<string, { missing: number; rate: number }> = {};
  const rowIndexesWithMissing: number[] = [];
  let missingCells = 0;
  const totalCells = table.rows.length * table.columns.length;

  for (const col of table.columns) {
    let missing = 0;
    table.rows.forEach((row, idx) => {
      const v = row[col];
      if (v === null || v === undefined || v === "") {
        missing += 1;
        missingCells += 1;
        if (!rowIndexesWithMissing.includes(idx)) rowIndexesWithMissing.push(idx);
      }
    });
    byColumn[col] = {
      missing,
      rate: table.rows.length === 0 ? 0 : Number((missing / table.rows.length).toFixed(4)),
    };
  }

  return { totalCells, missingCells, byColumn, rowIndexesWithMissing };
}

export const detect_missing_values: ProcedureHandler = (input) => {
  const missing = detectMissingValues(input.table ?? input);
  return { ok: true, output: { missing } };
};
