export type AmbientContext = {
  nowIso: string;
  dateHuman: string;
  timeHuman: string;
  timezone: string;
  locale: string;
  workspaceName: string;
  userName: string;
  userRole?: string;
  businessContext?: string;
};

export type AmbientContextInput = {
  now?: Date;
  timezone?: string | null;
  locale?: string | null;
  workspaceName?: string | null;
  userName?: string | null;
  userRole?: string | null;
  businessContext?: string | null;
};

const DEFAULT_LOCALE = "en-US";

function fallbackTimezone(): string {
  return process.env.ADEHQ_DEFAULT_TIMEZONE || process.env.TZ || "UTC";
}

function normalizeTimezone(timezone: string | null | undefined): string {
  const candidate = timezone?.trim() || fallbackTimezone();
  try {
    new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function formatDate(now: Date, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  }).format(now);
}

function formatTime(now: Date, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(now);
}

export function createAmbientContext(input: AmbientContextInput = {}): AmbientContext {
  const now = input.now ?? new Date();
  const timezone = normalizeTimezone(input.timezone);
  const locale = input.locale?.trim() || DEFAULT_LOCALE;

  return {
    nowIso: now.toISOString(),
    dateHuman: formatDate(now, locale, timezone),
    timeHuman: formatTime(now, locale, timezone),
    timezone,
    locale,
    workspaceName: input.workspaceName?.trim() || "this workspace",
    userName: input.userName?.trim() || "your teammate",
    userRole: input.userRole?.trim() || undefined,
    businessContext: input.businessContext?.trim() || undefined,
  };
}

export function buildAmbientBlock(ctx: AmbientContext): string {
  const workspaceLine = ctx.businessContext
    ? `Workspace: ${ctx.workspaceName} (${ctx.businessContext}).`
    : `Workspace: ${ctx.workspaceName}.`;
  const userLine = ctx.userRole
    ? `You're talking with ${ctx.userName} (${ctx.userRole}).`
    : `You're talking with ${ctx.userName}.`;

  return [
    "## Current context",
    `Today is ${ctx.dateHuman}, ${ctx.timeHuman} (${ctx.timezone}).`,
    `${workspaceLine} ${userLine}`,
    "Treat this as ground truth. Never say you don't know the current date or time.",
  ].join("\n");
}
