const DEFAULT_SUPABASE_URL = "https://psufoswopnknzhxfyvwa.supabase.co";

/** Verified publishable key for the default AdeHQ Supabase project. */
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_WAMHljbrQbfHMruVyMydUg_Kxls2gKY";

function trim(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

/** Never use secret/service keys in the browser. */
export function isPlausiblePublishableKey(key: string | undefined): key is string {
  if (!key || key.length < 24) return false;
  const lower = key.toLowerCase();
  if (lower.includes("your-") || lower.includes("placeholder") || lower.includes("example")) {
    return false;
  }
  if (key.startsWith("sb_secret_")) return false;
  return key.startsWith("sb_publishable_") || key.startsWith("eyJ");
}

function pickEnvPublishableKey(): string | undefined {
  const candidates = [
    trim(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    trim(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    trim(process.env.SUPABASE_PUBLISHABLE_KEY),
    trim(process.env.SUPABASE_ANON_KEY),
  ];
  return candidates.find(isPlausiblePublishableKey);
}

export function resolveSupabaseUrl(): string {
  return trim(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? DEFAULT_SUPABASE_URL;
}

/**
 * Resolves the Supabase publishable (anon) key.
 * For the default AdeHQ project, falls back to the verified key when Vercel env is missing or invalid.
 */
export function resolveSupabasePublishableKey(): string {
  const url = resolveSupabaseUrl();
  const envKey = pickEnvPublishableKey();

  if (url === DEFAULT_SUPABASE_URL) {
    if (envKey?.startsWith("sb_publishable_")) return envKey;
    return DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  }

  if (envKey) return envKey;

  throw new Error(
    "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
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
] as const;
