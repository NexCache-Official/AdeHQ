/** Activation-anchored 168h usage clock (independent of billing anniversary). */

export const USAGE_PERIOD_MS = 168 * 60 * 60 * 1000;

/** Floor timestamp to the top of the UTC hour. */
export function floorToHour(isoOrDate: string | Date): Date {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : new Date(isoOrDate.getTime());
  d.setUTCMinutes(0, 0, 0);
  d.setUTCMilliseconds(0);
  return d;
}

export function usagePeriodKey(periodStart: Date): string {
  return periodStart.toISOString();
}

export function usagePeriodIdempotencyKey(workspaceId: string, periodStart: Date): string {
  return `workspace:${workspaceId}:usage-period:${periodStart.toISOString()}`;
}

/**
 * Given an anchor and "now", return the open usage period [start, end).
 */
export function getUsagePeriodForAnchor(
  anchorAt: string | Date,
  now: Date = new Date(),
): { startedAt: Date; endsAt: Date; periodKey: string } {
  const anchor = floorToHour(anchorAt);
  const nowMs = now.getTime();
  const anchorMs = anchor.getTime();
  if (nowMs < anchorMs) {
    return {
      startedAt: anchor,
      endsAt: new Date(anchorMs + USAGE_PERIOD_MS),
      periodKey: usagePeriodKey(anchor),
    };
  }
  const elapsed = nowMs - anchorMs;
  const index = Math.floor(elapsed / USAGE_PERIOD_MS);
  const startedAt = new Date(anchorMs + index * USAGE_PERIOD_MS);
  const endsAt = new Date(startedAt.getTime() + USAGE_PERIOD_MS);
  return { startedAt, endsAt, periodKey: usagePeriodKey(startedAt) };
}

/**
 * First usage-period start on or after `effectiveAt`, given the usage anchor.
 */
export function firstUsagePeriodStartOnOrAfter(
  anchorAt: string | Date,
  effectiveAt: Date,
): Date {
  const { startedAt, endsAt } = getUsagePeriodForAnchor(anchorAt, effectiveAt);
  if (startedAt.getTime() >= effectiveAt.getTime()) return startedAt;
  // Mid-period: next boundary
  return endsAt;
}

/** Clamp billing anniversary for short months (31 Jan → 28/29 Feb → 31 Mar). */
export function addBillingPeriod(
  from: Date,
  cadence: "monthly" | "annual",
): Date {
  const day = from.getUTCDate();
  const next = new Date(from.getTime());
  if (cadence === "annual") {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  // If day overflowed (e.g. Jan 31 → Mar 3), clamp to last day of target month
  if (next.getUTCDate() !== day) {
    next.setUTCDate(0); // last day of previous month = intended month end
  }
  return next;
}
