/**
 * Customer-facing Work Hours always round down to 2dp.
 * 0.079 → 0.07 until usage actually reaches 0.08.
 */
export function floorDisplayHours(workHours: number): number {
  if (!Number.isFinite(workHours) || workHours <= 0) return 0;
  return Math.floor(workHours * 100 + 1e-9) / 100;
}

/**
 * Floor each leaf for the breakdown table, but derive `total` from the raw sum
 * first. Flooring leaves individually then summing drops sub-0.01 shards and can
 * zero the sidebar meter even when the period has real usage.
 */
export function floorDisplayTree<T extends { workHours: number }>(
  leaves: T[],
): { rows: T[]; total: number } {
  const rawTotal = leaves.reduce((sum, row) => {
    const hours = Number(row.workHours);
    return sum + (Number.isFinite(hours) && hours > 0 ? hours : 0);
  }, 0);
  const total = floorDisplayHours(rawTotal);
  const rows = leaves
    .map((row) => ({ ...row, workHours: floorDisplayHours(row.workHours) }))
    .filter((row) => row.workHours > 0);
  return { rows, total };
}
