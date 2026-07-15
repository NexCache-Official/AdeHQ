/**
 * Customer-facing Work Hours always round down to 2dp.
 * 0.079 → 0.07 until usage actually reaches 0.08.
 */
export function floorDisplayHours(workHours: number): number {
  if (!Number.isFinite(workHours) || workHours <= 0) return 0;
  return Math.floor(workHours * 100 + 1e-9) / 100;
}

/** Floor each leaf, then set parents to the sum of children so totals always match. */
export function floorDisplayTree<T extends { workHours: number }>(
  leaves: T[],
): { rows: T[]; total: number } {
  const rows = leaves
    .map((row) => ({ ...row, workHours: floorDisplayHours(row.workHours) }))
    .filter((row) => row.workHours > 0);
  const total = rows.reduce((sum, row) => sum + row.workHours, 0);
  return { rows, total };
}
