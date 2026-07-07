export type ManagedProviderId = "siliconflow" | "vercel_gateway" | "tavily" | "browserbase";

export type PlatformProviderId =
  | ManagedProviderId
  | "revolut"
  | "stripe"
  | "vercel_control"
  | "internal";

export const METERED_PROVIDER_IDS: ManagedProviderId[] = [
  "siliconflow",
  "vercel_gateway",
  "tavily",
  "browserbase",
];

export type CredentialSource = "workspace_allocation" | "global_pool" | "env_fallback";

export type ResolvedCredential = {
  provider: ManagedProviderId;
  credentialId?: string;
  allocationId?: string;
  apiKey: string;
  baseURL?: string;
  source: CredentialSource;
  providerProjectId?: string;
  budgetWarning?: boolean;
};

export type CredentialHealth = {
  credentialId: string;
  requestsToday: number;
  requestsMonth: number;
  costTodayUsd: number;
  costMonthUsd: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  fallbackCount: number;
  errorRate: number;
  timeoutRate: number;
  fallbackRate: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
};

export type CredentialBudgetStatus = {
  status: "under" | "near" | "over";
  reason?: string;
  costTodayUsd: number;
  costMonthUsd: number;
  requestsToday: number;
  requestsMonth: number;
};

export type CredentialRow = {
  id: string;
  provider: ManagedProviderId;
  label: string;
  scope: string;
  secret_ref: string;
  status: string;
  key_last4?: string;
  key_fingerprint_sha256?: string;
  encryption_key_version?: number;
  daily_limit_usd?: number | null;
  daily_limit_requests?: number | null;
  monthly_limit_usd?: number | null;
  monthly_limit_requests?: number | null;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AllocationRow = {
  id: string;
  workspace_id: string;
  provider: ManagedProviderId;
  credential_id?: string | null;
  allocation_type: string;
  provider_project_id?: string | null;
  status: string;
};
