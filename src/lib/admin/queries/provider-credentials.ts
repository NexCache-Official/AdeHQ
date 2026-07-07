import type { SupabaseClient } from "@supabase/supabase-js";
import { getCredentialBudgetStatus } from "@/lib/providers/credentials/budget";
import { providerConfiguredByEnv } from "@/lib/providers/credentials/env";
import { getCredentialHealth } from "@/lib/providers/credentials/health";
import type { CredentialBudgetStatus, CredentialHealth, ManagedProviderId } from "@/lib/providers/credentials/types";

type DbRow = Record<string, unknown>;

export type ProviderCredentialSummaryRow = {
  id: string;
  provider: string;
  label: string;
  scope: string;
  status: string;
  keyLast4: string;
  keyFingerprintSha256: string;
  encryptionKeyVersion: number;
  dailyLimitUsd: number | null;
  monthlyLimitUsd: number | null;
  dailyLimitRequests: number | null;
  monthlyLimitRequests: number | null;
  rotatedAt: string | null;
  lastUsedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastTestedAt: string | null;
  allocatedWorkspaceCount: number;
  duplicateFingerprint: boolean;
  envFallbackInUse: boolean;
  health: CredentialHealth | null;
  budget: CredentialBudgetStatus | null;
  createdAt: string;
};

export type ProviderAllocationSummaryRow = {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  provider: string;
  credentialId: string | null;
  allocationType: string;
  providerProjectId: string | null;
  status: string;
  pausedReason: string | null;
  pausedAt: string | null;
};

export type ProviderCredentialsSummary = {
  credentials: ProviderCredentialSummaryRow[];
  allocations: ProviderAllocationSummaryRow[];
  envFallbackProviders: string[];
};

function credentialFromRow(row: DbRow) {
  return {
    id: String(row.id),
    provider: String(row.provider) as ManagedProviderId,
    label: String(row.label),
    scope: String(row.scope),
    secret_ref: String(row.secret_ref),
    status: String(row.status),
    daily_limit_usd: row.daily_limit_usd == null ? null : Number(row.daily_limit_usd),
    daily_limit_requests: row.daily_limit_requests == null ? null : Number(row.daily_limit_requests),
    monthly_limit_usd: row.monthly_limit_usd == null ? null : Number(row.monthly_limit_usd),
    monthly_limit_requests: row.monthly_limit_requests == null ? null : Number(row.monthly_limit_requests),
  };
}

export async function getProviderCredentialsSummary(
  client: SupabaseClient,
): Promise<ProviderCredentialsSummary> {
  const [credentialRes, allocationRes] = await Promise.all([
    client
      .from("platform_provider_credentials")
      .select(
        "id, provider, label, scope, status, key_last4, key_fingerprint_sha256, encryption_key_version, daily_limit_usd, daily_limit_requests, monthly_limit_usd, monthly_limit_requests, rotated_at, last_used_at, last_success_at, last_failure_at, last_tested_at, created_at",
      )
      .order("created_at", { ascending: false }),
    client
      .from("workspace_provider_allocations")
      .select("id, workspace_id, provider, credential_id, allocation_type, provider_project_id, status, paused_reason, paused_at, workspaces(name)")
      .order("created_at", { ascending: false }),
  ]);
  if (credentialRes.error) throw credentialRes.error;
  if (allocationRes.error) throw allocationRes.error;

  const allocations = ((allocationRes.data as DbRow[] | null) ?? []).map((row) => {
    const workspace = row.workspaces as { name?: string } | null;
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      workspaceName: workspace?.name ? String(workspace.name) : null,
      provider: String(row.provider),
      credentialId: row.credential_id ? String(row.credential_id) : null,
      allocationType: String(row.allocation_type),
      providerProjectId: row.provider_project_id ? String(row.provider_project_id) : null,
      status: String(row.status),
      pausedReason: row.paused_reason ? String(row.paused_reason) : null,
      pausedAt: row.paused_at ? String(row.paused_at) : null,
    };
  });

  const fingerprintCounts = new Map<string, number>();
  for (const row of (credentialRes.data as DbRow[] | null) ?? []) {
    const key = `${row.provider}:${row.key_fingerprint_sha256}`;
    fingerprintCounts.set(key, (fingerprintCounts.get(key) ?? 0) + 1);
  }

  const credentials: ProviderCredentialSummaryRow[] = [];
  for (const row of (credentialRes.data as DbRow[] | null) ?? []) {
    const id = String(row.id);
    const provider = String(row.provider);
    const credential = credentialFromRow(row);
    const [health, budget] = await Promise.all([
      getCredentialHealth(client, id).catch(() => null),
      getCredentialBudgetStatus(client, credential).catch(() => null),
    ]);
    credentials.push({
      id,
      provider,
      label: String(row.label),
      scope: String(row.scope),
      status: String(row.status),
      keyLast4: String(row.key_last4 ?? ""),
      keyFingerprintSha256: String(row.key_fingerprint_sha256 ?? ""),
      encryptionKeyVersion: Number(row.encryption_key_version ?? 1),
      dailyLimitUsd: row.daily_limit_usd == null ? null : Number(row.daily_limit_usd),
      monthlyLimitUsd: row.monthly_limit_usd == null ? null : Number(row.monthly_limit_usd),
      dailyLimitRequests: row.daily_limit_requests == null ? null : Number(row.daily_limit_requests),
      monthlyLimitRequests: row.monthly_limit_requests == null ? null : Number(row.monthly_limit_requests),
      rotatedAt: row.rotated_at ? String(row.rotated_at) : null,
      lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
      lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
      lastFailureAt: row.last_failure_at ? String(row.last_failure_at) : null,
      lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
      allocatedWorkspaceCount: allocations.filter((a) => a.credentialId === id).length,
      duplicateFingerprint: (fingerprintCounts.get(`${provider}:${row.key_fingerprint_sha256}`) ?? 0) > 1,
      envFallbackInUse: providerConfiguredByEnv(provider as ManagedProviderId),
      health,
      budget,
      createdAt: String(row.created_at),
    });
  }

  const envFallbackProviders = ["siliconflow", "vercel_gateway", "tavily", "browserbase"].filter((provider) =>
    providerConfiguredByEnv(provider as ManagedProviderId),
  );

  return { credentials, allocations, envFallbackProviders };
}
