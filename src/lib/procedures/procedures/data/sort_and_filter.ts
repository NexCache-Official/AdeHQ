import type { ProcedureHandler } from "../../contracts";
import { asTable, type TableData } from "./types";

export type SortFilterOpts = {
  sortBy?: string;
  sortDir?: "asc" | "desc";
  equals?: Record<string, unknown>;
  limit?: number;
};

export function sortAndFilter(tableInput: unknown, opts: SortFilterOpts = {}): TableData {
  const table = asTable(tableInput);
  let rows = [...table.rows];

  if (opts.equals && typeof opts.equals === "object") {
    rows = rows.filter((row) =>
      Object.entries(opts.equals!).every(([k, v]) => row[k] === v),
    );
  }

  if (opts.sortBy) {
    const key = opts.sortBy;
    const dir = opts.sortDir === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  if (typeof opts.limit === "number" && opts.limit >= 0) {
    rows = rows.slice(0, opts.limit);
  }

  return { columns: table.columns, rows };
}

export const sort_and_filter: ProcedureHandler = (input) => {
  const table = sortAndFilter(input.table ?? input, {
    sortBy: typeof input.sortBy === "string" ? input.sortBy : undefined,
    sortDir: input.sortDir === "desc" ? "desc" : "asc",
    equals:
      input.equals && typeof input.equals === "object"
        ? (input.equals as Record<string, unknown>)
        : undefined,
    limit: typeof input.limit === "number" ? input.limit : undefined,
  });
  return { ok: true, output: { table } };
};
