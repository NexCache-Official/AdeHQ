import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminRange = "1d" | "7d" | "30d" | "90d";

const RANGE_DAYS: Record<AdminRange, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function parseRange(raw: string | null, fallback: AdminRange = "7d"): AdminRange {
  if (raw === "1d" || raw === "7d" || raw === "30d" || raw === "90d") return raw;
  return fallback;
}

export function rangeStart(range: AdminRange): string {
  const start = new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Exact count with optional filters, without fetching rows. */
export async function countRows(
  client: SupabaseClient,
  table: string,
  filter?: (query: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => unknown,
): Promise<number> {
  let query = client.from(table).select("*", { count: "exact", head: true });
  if (filter) {
    query = filter(query) as typeof query;
  }
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export function sumBy<T>(rows: T[], pick: (row: T) => number | null | undefined): number {
  return rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
}

export function groupSum<T>(
  rows: T[],
  keyOf: (row: T) => string,
  valueOf: (row: T) => number,
): { key: string; value: number; count: number }[] {
  const map = new Map<string, { value: number; count: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const entry = map.get(key) ?? { value: 0, count: 0 };
    entry.value += valueOf(row);
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.entries()]
    .map(([key, { value, count }]) => ({ key, value, count }))
    .sort((a, b) => b.value - a.value);
}

export function effectiveCostUsd(row: {
  actual_cost_usd: number | null;
  estimated_cost_usd: number | null;
}): number {
  return Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
}

/** Row fetch cap for in-process aggregation — plenty for the current platform scale. */
export const AGGREGATION_ROW_LIMIT = 20000;
