import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Platform feature flags — server-side only.
 * Resolution order: DB (platform_feature_flags, global scope) → env fallback → default.
 * A short in-memory cache keeps product hot paths (agent runs, signup) cheap.
 */

export type PlatformFlagKey =
  | "signups_enabled"
  | "invite_only_mode"
  | "maintenance_mode"
  | "maintenance_message"
  | "ai_runs_enabled"
  | "browser_research_enabled"
  | "gateway_search_enabled"
  | "tavily_enabled"
  | "file_uploads_enabled"
  | "runtime_v2_mode"
  | "route_optimizer_mode"
  | "employee_direct_execution"
  | "employee_queued_execution";

const FLAG_DEFAULTS: Record<string, unknown> = {
  signups_enabled: true,
  invite_only_mode: false,
  maintenance_mode: false,
  maintenance_message: "",
  ai_runs_enabled: true,
  browser_research_enabled: true,
  gateway_search_enabled: true,
  tavily_enabled: true,
  file_uploads_enabled: true,
  runtime_v2_mode: "off",
  route_optimizer_mode: "off",
  employee_direct_execution: false,
  employee_queued_execution: false,
};

/** Optional env fallbacks if the DB row is missing (e.g. before migration runs). */
const FLAG_ENV_FALLBACKS: Partial<Record<PlatformFlagKey, string>> = {
  signups_enabled: "PLATFORM_SIGNUPS_ENABLED",
  maintenance_mode: "PLATFORM_MAINTENANCE_MODE",
  ai_runs_enabled: "PLATFORM_AI_RUNS_ENABLED",
  browser_research_enabled: "PLATFORM_BROWSER_RESEARCH_ENABLED",
  runtime_v2_mode: "AI_RUNTIME_V2_MODE",
  route_optimizer_mode: "AI_RUNTIME_ROUTE_OPTIMIZER",
  employee_direct_execution: "AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION",
  employee_queued_execution: "AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION",
};

const CACHE_TTL_MS = 15_000;

type FlagCache = {
  values: Map<string, unknown>;
  fetchedAt: number;
};

let cache: FlagCache | null = null;

function parseEnvBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

async function loadGlobalFlags(client?: SupabaseClient): Promise<Map<string, unknown>> {
  const serviceClient = client ?? createServiceRoleClient();
  const { data, error } = await serviceClient
    .from("platform_feature_flags")
    .select("key, value")
    .eq("scope", "global");

  if (error) throw error;

  const values = new Map<string, unknown>();
  for (const row of data ?? []) {
    values.set(row.key, row.value);
  }
  return values;
}

/** Invalidate the in-process cache (call after flag mutations). */
export function invalidatePlatformFlagCache(): void {
  cache = null;
}

/**
 * Resolve a platform flag: DB → env → default.
 * Fails open to the default value on DB errors so a flags outage
 * never takes down the product.
 */
export async function getPlatformFlag<T = unknown>(
  key: PlatformFlagKey | string,
  client?: SupabaseClient,
): Promise<T> {
  let values: Map<string, unknown> | null = null;

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    values = cache.values;
  } else {
    try {
      values = await loadGlobalFlags(client);
      cache = { values, fetchedAt: Date.now() };
    } catch (error) {
      console.error("[AdeHQ Control] platform flag load failed:", error);
      values = cache?.values ?? null;
    }
  }

  if (values?.has(key)) {
    return values.get(key) as T;
  }

  const envName = FLAG_ENV_FALLBACKS[key as PlatformFlagKey];
  if (envName) {
    const envRaw = process.env[envName];
    if (envRaw !== undefined && envRaw.trim() !== "") {
      if (typeof FLAG_DEFAULTS[key] === "boolean") {
        const envValue = parseEnvBoolean(envRaw);
        if (envValue !== undefined) return envValue as T;
      } else {
        return envRaw.trim() as T;
      }
    }
  }

  return (FLAG_DEFAULTS[key] ?? undefined) as T;
}

/** Sync read from warmed cache — used by getRuntimeFlags after preloadPlatformFlags(). */
export function getCachedPlatformFlag(key: string): unknown | undefined {
  return cache?.values.get(key);
}

/** Warm the platform flag cache (call at start of server handlers). */
export async function preloadPlatformFlags(client?: SupabaseClient): Promise<void> {
  const values = await loadGlobalFlags(client);
  cache = { values, fetchedAt: Date.now() };
}

/** Convenience for boolean flags. */
export async function isPlatformFlagEnabled(
  key: PlatformFlagKey,
  client?: SupabaseClient,
): Promise<boolean> {
  const value = await getPlatformFlag(key, client);
  return value === true;
}
