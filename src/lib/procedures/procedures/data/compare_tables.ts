import type { ProcedureHandler } from "../../contracts";
import { asTable } from "./types";

export function compareTables(leftInput: unknown, rightInput: unknown, keyColumns?: string[]) {
  const left = asTable(leftInput);
  const right = asTable(rightInput);
  const keys =
    keyColumns?.length ? keyColumns : left.columns.filter((c) => right.columns.includes(c));

  const sig = (row: Record<string, unknown>) => JSON.stringify(keys.map((k) => row[k]));
  const leftMap = new Map(left.rows.map((r) => [sig(r), r]));
  const rightMap = new Map(right.rows.map((r) => [sig(r), r]));

  const onlyLeft = [...leftMap.keys()].filter((k) => !rightMap.has(k)).length;
  const onlyRight = [...rightMap.keys()].filter((k) => !leftMap.has(k)).length;
  const shared = [...leftMap.keys()].filter((k) => rightMap.has(k));
  let differing = 0;
  for (const k of shared) {
    if (JSON.stringify(leftMap.get(k)) !== JSON.stringify(rightMap.get(k))) differing += 1;
  }

  return {
    keyColumns: keys,
    leftRowCount: left.rows.length,
    rightRowCount: right.rows.length,
    onlyLeft,
    onlyRight,
    shared: shared.length,
    differing,
    columnDiff: {
      onlyLeft: left.columns.filter((c) => !right.columns.includes(c)),
      onlyRight: right.columns.filter((c) => !left.columns.includes(c)),
    },
  };
}

export const compare_tables: ProcedureHandler = (input) => {
  const comparison = compareTables(
    input.left ?? input.tableA,
    input.right ?? input.tableB,
    Array.isArray(input.keys) ? input.keys.map(String) : undefined,
  );
  return { ok: true, output: { comparison } };
};
