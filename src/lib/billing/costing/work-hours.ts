/**
 * AI Work Hours conversion (commercial unit).
 *
 * Public unit: 1 AI Work Hour = $0.01 of internal billable AI cost (pinned).
 * This is a different unit than the legacy shadow "work minutes" (which used $0.01/minute).
 * The internal USD-per-Work-Hour rate is a platform secret and must never be shown to customers.
 *
 * Brain D1: AI_WORK_HOUR_USD env override removed — rate is always $0.01.
 * Per-row work_hour_usd_rate on the ledger records the rate used at charge time.
 */

export const AI_WORK_HOUR_USD = 0.01;

/** Internal USD cost that equals one AI Work Hour. */
export function getWorkHourUsdRate(): number {
  return AI_WORK_HOUR_USD;
}

/** Convert a billable USD cost to AI Work Hours. */
export function workHoursFromCost(costUsd: number, rate = getWorkHourUsdRate()): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((costUsd / rate) * 10000) / 10000;
}

/**
 * Customer-facing Work Hours: always round down to 2dp.
 * 0.079 stays 0.07 until usage actually crosses 0.08.
 */
export function displayWorkHours(workHours: number): number {
  if (!Number.isFinite(workHours) || workHours <= 0) return 0;
  return Math.floor(workHours * 100 + 1e-9) / 100;
}
