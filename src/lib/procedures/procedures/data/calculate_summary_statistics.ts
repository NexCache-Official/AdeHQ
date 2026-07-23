import type { ProcedureHandler } from "../../contracts";
import { asTable } from "./types";

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return Number(v);
  }
  return null;
}

export function calculateSummaryStatistics(tableInput: unknown): Record<
  string,
  { count: number; min: number | null; max: number | null; mean: number | null; sum: number }
> {
  const table = asTable(tableInput);
  const out: Record<
    string,
    { count: number; min: number | null; max: number | null; mean: number | null; sum: number }
  > = {};

  for (const col of table.columns) {
    const nums = table.rows.map((r) => toNumber(r[col])).filter((n): n is number => n != null);
    if (nums.length === 0) {
      out[col] = { count: 0, min: null, max: null, mean: null, sum: 0 };
      continue;
    }
    const sum = nums.reduce((a, b) => a + b, 0);
    out[col] = {
      count: nums.length,
      min: Math.min(...nums),
      max: Math.max(...nums),
      mean: Number((sum / nums.length).toFixed(6)),
      sum: Number(sum.toFixed(6)),
    };
  }
  return out;
}

export const calculate_summary_statistics: ProcedureHandler = (input) => {
  const statistics = calculateSummaryStatistics(input.table ?? input);
  return { ok: true, output: { statistics } };
};
