import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getSecret } from "@/lib/security/secrets/store";
import { getCredentialBudgetStatus } from "./budget";
import { envBaseUrlForProvider, envKeyForProvider, allowProviderEnvFallback } from "./env";
import { getCredentialHealth, isHealthy } from "./health";
import { recordCredentialEvent } from "./record-credential-event";
import type {
  AllocationRow,
  CredentialRow,
  ManagedProviderId,
  ResolvedCredential,
} from "./types";

type DbRow = Record<string, unknown>;

type CacheEntry = {
  expiresAt: number;
  value: ResolvedCredential;
};

const CACHE_TTL_MS = Number(process.env.PROVIDER_CREDENTIAL_CACHE_TTL_MS ?? 30_000);
const resolvedCache = new Map<string, CacheEntry>();

function cacheKey(workspaceId: string | undefined, provider: ManagedProviderId): string {
  return `${workspaceId ?? "platform"}:${provider}`;
}

function rowToCredential(row: DbRow): CredentialRow {
  return {
    id: String(row.id),
    provider: String(row.provider) as ManagedProviderId,
    label: String(row.label ?? ""),
    scope: String(row.scope ?? "global_pool"),
    secret_ref: String(row.secret_ref ?? ""),
    status: String(row.status ?? "untested"),
    key_last4: row.key_last4 ? String(row.key_last4) : undefined,
    key_fingerprint_sha256: row.key_fingerprint_sha256 ? String(row.key_fingerprint_sha256) : undefined,
    encryption_key_version: row.encryption_key_version ? Number(row.encryption_key_version) : undefined,
    daily_limit_usd: row.daily_limit_usd == null ? null : Number(row.daily_limit_usd),
    daily_limit_requests: row.daily_limit_requests == null ? null : Number(row.daily_limit_requests),
    monthly_limit_usd: row.monthly_limit_usd == null ? null : Number(row.monthly_limit_usd),
    monthly_limit_requests: row.monthly_limit_requests == null ? null : Number(row.monthly_limit_requests),
    last_success_at: row.last_success_at ? String(row.last_success_at) : null,
    last_failure_at: row.last_failure_at ? String(row.last_failure_at) : null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  };
}

function rowToAllocation(row: DbRow): AllocationRow {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    provider: String(row.provider) as ManagedProviderId,
    credential_id: row.credential_id ? String(row.credential_id) : null,
    allocation_type: String(row.allocation_type ?? "shared_pool"),
    provider_project_id: row.provider_project_id ? String(row.provider_project_id) : null,
    status: String(row.status ?? "active"),
  };
}

async function loadCredential(client: SupabaseClient, id: string): Promise<CredentialRow | null> {
  const { data, error } = await client
    .from("platform_provider_credentials")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToCredential(data as DbRow) : null;
}

async function loadWorkspaceAllocation(
  client: SupabaseClient,
  workspaceId: string | undefined,
  provider: ManagedProviderId,
): Promise<AllocationRow | null> {
  if (!workspaceId) return null;
  const { data, error } = await client
    .from("workspace_provider_allocations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToAllocation(data as DbRow) : null;
}

async function loadGlobalPool(client: SupabaseClient, provider: ManagedProviderId): Promise<CredentialRow[]> {
  const { data, error } = await client
    .from("platform_provider_credentials")
    .select("*")
    .eq("provider", provider)
    .eq("scope", "global_pool")
    .eq("status", "active")
    .order("last_failure_at", { ascending: true, nullsFirst: true })
    .order("last_success_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return ((data as DbRow[] | null) ?? []).map(rowToCredential);
}

async function candidateRows(
  client: SupabaseClient,
  workspaceId: string | undefined,
  provider: ManagedProviderId,
): Promise<Array<{ credential: CredentialRow; allocation?: AllocationRow; source: ResolvedCredential["source"] }>> {
  const allocation = await loadWorkspaceAllocation(client, workspaceId, provider);
  const candidates: Array<{ credential: CredentialRow; allocation?: AllocationRow; source: ResolvedCredential["source"] }> = [];

  if (allocation?.status === "active" && allocation.credential_id) {
    const credential = await loadCredential(client, allocation.credential_id);
    if (credential && credential.status === "active") {
      candidates.push({ credential, allocation, source: "workspace_allocation" });
    }
  }

  for (const credential of await loadGlobalPool(client, provider)) {
    if (!candidates.some((c) => c.credential.id === credential.id)) {
      candidates.push({ credential, allocation: allocation ?? undefined, source: "global_pool" });
    }
  }

  return candidates;
}

function envFallback(provider: ManagedProviderId, workspaceId?: string): ResolvedCredential | null {
  if (!allowProviderEnvFallback()) return null;
  const apiKey = envKeyForProvider(provider);
  if (!apiKey) return null;
  return {
    provider,
    apiKey,
    baseURL: envBaseUrlForProvider(provider),
    source: "env_fallback",
  };
}

export async function resolveProviderCredential(input: {
  workspaceId?: string;
  provider: ManagedProviderId;
  client?: SupabaseClient;
  requiredScope?: "metered" | "platform";
  skipCache?: boolean;
}): Promise<ResolvedCredential> {
  const key = cacheKey(input.workspaceId, input.provider);
  if (!input.skipCache) {
    const cached = resolvedCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }

  const client = input.client ?? createServiceRoleClient();
  let candidates: Awaited<ReturnType<typeof candidateRows>> = [];
  try {
    candidates = await candidateRows(client, input.workspaceId, input.provider);
  } catch (error) {
    console.warn("[AdeHQ provider credentials] candidate load failed", error);
  }

  const healthById = new Map<string, Awaited<ReturnType<typeof getCredentialHealth>>>();
  for (const candidate of candidates) {
    try {
      healthById.set(candidate.credential.id, await getCredentialHealth(client, candidate.credential.id));
    } catch {
      // Missing ledger during migration should not prevent env fallback.
    }
  }
  const healthyAvailable = candidates.some((c) => {
    const health = healthById.get(c.credential.id);
    return !health || isHealthy(health);
  });

  for (const candidate of candidates) {
    const { credential, allocation, source } = candidate;
    const budget = await getCredentialBudgetStatus(client, credential).catch(() => ({
      status: "under" as const,
      costTodayUsd: 0,
      costMonthUsd: 0,
      requestsToday: 0,
      requestsMonth: 0,
    }));
    if (budget.status === "over") {
      void recordCredentialEvent(client, {
        credentialId: credential.id,
        workspaceId: input.workspaceId,
        provider: input.provider,
        eventType: "budget_exceeded",
        reason: budget.reason,
        metadata: budget,
      });
      continue;
    }

    const health = healthById.get(credential.id);
    if (health && healthyAvailable && !isHealthy(health)) {
      void recordCredentialEvent(client, {
        credentialId: credential.id,
        workspaceId: input.workspaceId,
        provider: input.provider,
        eventType: "health_skipped",
        reason: "Credential health degraded and another candidate is available.",
        metadata: health,
      });
      continue;
    }

    const resolved: ResolvedCredential = {
      provider: input.provider,
      credentialId: credential.id,
      allocationId: allocation?.id,
      providerProjectId: allocation?.provider_project_id ?? undefined,
      apiKey: getSecret(credential.secret_ref),
      baseURL: envBaseUrlForProvider(input.provider),
      source,
      budgetWarning: budget.status === "near",
    };
    resolvedCache.set(key, { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    return resolved;
  }

  const fallback = envFallback(input.provider, input.workspaceId);
  if (fallback) {
    void recordCredentialEvent(client, {
      workspaceId: input.workspaceId,
      provider: input.provider,
      eventType: "fallback_used",
      reason: "No managed credential qualified; using environment fallback.",
      metadata: { provider: input.provider },
    });
    resolvedCache.set(key, { value: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
    return fallback;
  }

  throw new Error(`No usable ${input.provider} credential is available.`);
}

export function clearProviderCredentialCache(): void {
  resolvedCache.clear();
}
