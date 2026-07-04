/** Monday 00:00 UTC for the week containing `date`. */
export function getBillingWeekStart(date: Date = new Date()): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diffToMonday);
  return formatUtcDate(utc);
}

/** First day of month UTC for `date`. */
export function getBillingMonthStart(date: Date = new Date()): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return formatUtcDate(utc);
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseUtcDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

/** Exclusive end date (next Monday) for a billing week. */
export function getBillingWeekEndExclusive(weekStart: string): string {
  const end = parseUtcDate(weekStart);
  end.setUTCDate(end.getUTCDate() + 7);
  return formatUtcDate(end);
}

export function getBillingWeekRangeIso(weekStart: string): {
  startIso: string;
  endExclusiveIso: string;
} {
  return {
    startIso: `${weekStart}T00:00:00.000Z`,
    endExclusiveIso: `${getBillingWeekEndExclusive(weekStart)}T00:00:00.000Z`,
  };
}
