import type { ProcedureHandler } from "../../contracts";
import { asTable, type TableData } from "./types";

export type RowTransform =
  | { op: "rename"; from: string; to: string }
  | { op: "drop"; column: string }
  | { op: "fill"; column: string; value: unknown }
  | { op: "trim_strings" };

export function transformRows(tableInput: unknown, transforms: RowTransform[] = []): TableData {
  let table = asTable(tableInput);
  let columns = [...table.columns];
  let rows = table.rows.map((r) => ({ ...r }));

  for (const t of transforms) {
    if (t.op === "rename") {
      columns = columns.map((c) => (c === t.from ? t.to : c));
      rows = rows.map((row) => {
        if (!(t.from in row)) return row;
        const next = { ...row, [t.to]: row[t.from] };
        delete next[t.from];
        return next;
      });
    } else if (t.op === "drop") {
      columns = columns.filter((c) => c !== t.column);
      rows = rows.map((row) => {
        const next = { ...row };
        delete next[t.column];
        return next;
      });
    } else if (t.op === "fill") {
      if (!columns.includes(t.column)) columns.push(t.column);
      rows = rows.map((row) => {
        const v = row[t.column];
        if (v === null || v === undefined || v === "") {
          return { ...row, [t.column]: t.value };
        }
        return row;
      });
    } else if (t.op === "trim_strings") {
      rows = rows.map((row) => {
        const next = { ...row };
        for (const k of Object.keys(next)) {
          if (typeof next[k] === "string") next[k] = (next[k] as string).trim();
        }
        return next;
      });
    }
  }

  return { columns, rows };
}

export const transform_rows: ProcedureHandler = (input) => {
  const transforms = Array.isArray(input.transforms)
    ? (input.transforms as RowTransform[])
    : [{ op: "trim_strings" as const }];
  const table = transformRows(input.table ?? input, transforms);
  return { ok: true, output: { table } };
};
