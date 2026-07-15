/**
 * AI Work Hours conversion (commercial unit).
 *
 * Public unit: 1 AI Work Hour = $0.01 of internal billable AI cost.
 * This is a different unit than the legacy shadow "work minutes" (which used $0.01/minute).
 * The internal USD-per-Work-Hour rate is a platform secret and must never be shown to customers.
 */

const DEFAULT_AI_WORK_HOUR_USD = 0.01;

/** Internal USD cost that equals one AI Work Hour. Configurable via env for platform tuning. */
export function getWorkHourUsdRate(): number {
  const raw = Number(process.env.AI_WORK_HOUR_USD);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_AI_WORK_HOUR_USD;
}

/** Convert a billable USD cost to AI Work Hours. */
export function workHoursFromCost(costUsd: number, rate = getWorkHourUsdRate()): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((costUsd / rate) * 10000) / 10000;
}

/** Round Work Hours to two decimals for customer-facing display (0.00). */
export function displayWorkHours(workHours: number): number {
  if (!Number.isFinite(workHours) || workHours <= 0) return 0;
  return Math.round(workHours * 100) / 100;
}
