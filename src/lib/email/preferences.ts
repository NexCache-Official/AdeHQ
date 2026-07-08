import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";

/** Every template declares one of these categories in the registry. */
export type EmailCategory =
  | "auth"
  | "security"
  | "billing"
  | "product_updates"
  | "weekly_reports"
  | "activity_notifications";

/**
 * Always-on categories are required for account operation / legal records.
 * They are never gated, carry no unsubscribe link, and are not represented in
 * the email_preferences table (they cannot be disabled).
 */
export const ALWAYS_ON_CATEGORIES: ReadonlySet<EmailCategory> = new Set([
  "auth",
  "security",
  "billing",
]);

/** Preference-gated categories map to a boolean column in email_preferences. */
export const PREFERENCE_COLUMNS = {
  product_updates: "product_updates",
  weekly_reports: "weekly_reports",
  activity_notifications: "activity_notifications",
} as const satisfies Partial<Record<EmailCategory, string>>;

export type PreferenceCategory = keyof typeof PREFERENCE_COLUMNS;

export function isAlwaysOn(category: EmailCategory): boolean {
  return ALWAYS_ON_CATEGORIES.has(category);
}

export function isPreferenceCategory(
  category: string,
): category is PreferenceCategory {
  return category in PREFERENCE_COLUMNS;
}

export const CATEGORY_LABELS: Record<PreferenceCategory, { title: string; description: string }> = {
  product_updates: {
    title: "Product updates",
    description: "New features, milestones, and welcome emails.",
  },
  weekly_reports: {
    title: "Weekly reports",
    description: "Workspace summaries, work-hours alerts, and intelligence reports.",
  },
  activity_notifications: {
    title: "Activity notifications",
    description: "Mentions, completed research/tasks, and approval requests.",
  },
};

export type EmailPreferencesRow = {
  user_id: string;
  email: string;
  product_updates: boolean;
  weekly_reports: boolean;
  activity_notifications: boolean;
  unsubscribe_token: string;
  updated_at: string;
};

/**
 * Fetch (or lazily create) the preference row for an email address. Rows
 * default to opted-in. Returns null only when we have no user_id to key on
 * (e.g. a recipient with no auth.users record) and none exists yet.
 */
export async function getOrCreatePreferences(
  recipient: string,
  options: { userId?: string | null; client?: SupabaseClient } = {},
): Promise<EmailPreferencesRow | null> {
  const client = options.client ?? createServiceRoleClient();
  const email = recipient.trim().toLowerCase();

  // Prefer lookup by user_id, else by email.
  if (options.userId) {
    const { data } = await client
      .from("email_preferences")
      .select("*")
      .eq("user_id", options.userId)
      .maybeSingle();
    if (data) return data as EmailPreferencesRow;

    const { data: created } = await client
      .from("email_preferences")
      .upsert({ user_id: options.userId, email }, { onConflict: "user_id" })
      .select("*")
      .single();
    return (created as EmailPreferencesRow) ?? null;
  }

  const { data } = await client
    .from("email_preferences")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  return (data as EmailPreferencesRow | null) ?? null;
}

/**
 * Preference gate. Always-on categories are allowed unconditionally. For gated
 * categories, a missing preference row means opted-in (default). Returns the
 * decision plus the unsubscribe token when one is available.
 */
export async function checkEmailAllowed(
  recipient: string,
  category: EmailCategory,
  options: { userId?: string | null; client?: SupabaseClient } = {},
): Promise<{ allowed: boolean; unsubscribeToken?: string }> {
  if (isAlwaysOn(category)) return { allowed: true };

  const prefs = await getOrCreatePreferences(recipient, options);
  if (!prefs) return { allowed: true }; // default opted-in, no token to gate on

  const column = PREFERENCE_COLUMNS[category as PreferenceCategory];
  const allowed = prefs[column as keyof EmailPreferencesRow] !== false;
  return { allowed, unsubscribeToken: prefs.unsubscribe_token };
}

/** Build the one-click unsubscribe URL for a gated category. */
export function buildUnsubscribeUrl(
  siteUrl: string,
  token: string,
  category: EmailCategory,
): string {
  return `${siteUrl}/api/email/unsubscribe?token=${encodeURIComponent(token)}&category=${encodeURIComponent(category)}`;
}
