const DEFAULT_SUPABASE_URL = "https://psufoswopnknzhxfyvwa.supabase.co";

/** Verified publishable key for the default AdeHQ Supabase project. */
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_WAMHljbrQbfHMruVyMydUg_Kxls2gKY";

function trim(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

/** Legacy Supabase API keys (anon / service_role JWTs) start with `eyJ`. */
export function isLegacyJwtKey(key: string | undefined): boolean {
  return Boolean(key && key.startsWith("eyJ"));
}

/** New publishable API key format (safe for the browser). */
export function isNewPublishableKey(key: string | undefined): boolean {
  return Boolean(key && key.startsWith("sb_publishable_"));
}

/** New secret API key format (server-only, bypasses RLS). */
export function isNewSecretKey(key: string | undefined): boolean {
  return Boolean(key && key.startsWith("sb_secret_"));
}

function assertNewPublishableKey(key: string, envName: string): string {
  if (isNewPublishableKey(key)) return key;
  if (isLegacyJwtKey(key)) {
    throw new Error(
      `${envName} must be a new-format publishable key (sb_publishable_…), not a legacy anon JWT. ` +
        "Create one in Supabase → Settings → API Keys.",
    );
  }
  throw new Error(
    `${envName} is not a valid Supabase publishable key (expected sb_publishable_…).`,
  );
}

function pickEnvPublishableKey(): string | undefined {
  const key = trim(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (!key) return undefined;
  return assertNewPublishableKey(key, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function resolveSupabaseUrl(): string {
  return trim(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? DEFAULT_SUPABASE_URL;
}

/**
 * Resolves the Supabase publishable key for browser / user-scoped clients.
 * For the default AdeHQ project, falls back to the verified key when Vercel env is missing.
 */
export function resolveSupabasePublishableKey(): string {
  const url = resolveSupabaseUrl();
  const envKey = pickEnvPublishableKey();

  if (url === DEFAULT_SUPABASE_URL) {
    if (envKey) return envKey;
    return DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  }

  if (envKey) return envKey;

  throw new Error(
    "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
  );
}

/**
 * Resolves the Supabase secret key for server-side writes (bypasses RLS).
 * Only accepts the new `sb_secret_…` format.
 */
export function resolveSupabaseSecretKey(): string | undefined {
  const key = trim(process.env.SUPABASE_SECRET_KEY);
  if (!key) return undefined;
  if (isNewSecretKey(key)) return key;
  if (isLegacyJwtKey(key)) {
    throw new Error(
      "SUPABASE_SECRET_KEY must be a new-format secret key (sb_secret_…), not a legacy service_role JWT. " +
        "Create one in Supabase → Settings → API Keys.",
    );
  }
  throw new Error(
    "SUPABASE_SECRET_KEY is not a valid Supabase secret key (expected sb_secret_…).",
  );
}

export const SUPABASE_PROJECT_URL = resolveSupabaseUrl();
export const SUPABASE_PUBLISHABLE_KEY = resolveSupabasePublishableKey();

export function isSupabaseApiKeyError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: string }).message)
        : String(error ?? "");
  return msg.toLowerCase().includes("invalid api key");
}

export const SUPABASE_WORKSPACE_TABLES = [
  "ai_employees",
  "employee_tools",
  "rooms",
  "topics",
  "topic_members",
  "room_members",
  "messages",
  "tasks",
  "memory_entries",
  "approvals",
  "work_log_events",
  "calls",
  "call_transcripts",
  "workspace_tools",
  "workspace_invitations",
  "workspace_ai_settings",
  "ai_usage_events",
  "agent_runs",
  "agent_run_steps",
  "ai_model_catalog",
  "ai_model_price_snapshots",
  "ai_model_sync_runs",
  "ai_model_route_health",
  "ai_work_units",
  "browser_research_runs",
  "workspace_search_cache",
  "topic_search_inflight",
  "topic_orchestration_state",
  "topic_context_imports",
  "ai_work_minutes_ledger",
  "ai_work_hours_simulation_events",
  "workspace_files",
  "file_chunks",
  "artifacts",
  "artifact_versions",
  "drive_folders",
  "browser_evidence",
  "drive_exports",
  "workspace_storage_quotas",
  "storage_usage_events",
  "message_attachments",
  "work_graph_edges",
  "crm_companies",
  "crm_contacts",
  "crm_pipeline_stages",
  "crm_deals",
  "workspace_mailboxes",
  "email_threads",
  "email_messages",
  "email_drafts",
  "email_outbox",
  "email_approvals",
] as const;
