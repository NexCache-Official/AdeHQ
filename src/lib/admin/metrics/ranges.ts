export type AdminRange = "1d" | "7d" | "30d" | "90d";

export const ADMIN_RANGE_DAYS: Record<AdminRange, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function parseAdminRange(raw: string | null, fallback: AdminRange = "7d"): AdminRange {
  if (raw === "1d" || raw === "7d" || raw === "30d" || raw === "90d") return raw;
  return fallback;
}

export function rangeStartIso(range: AdminRange): string {
  const start = new Date(Date.now() - ADMIN_RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
