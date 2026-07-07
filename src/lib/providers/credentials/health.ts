import type { SupabaseClient } from "@supabase/supabase-js";
import type { CredentialHealth, ManagedProviderId } from "./types";

type DbRow = Record<string, unknown>;

function dayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function monthStartIso(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function classifyFailure(row: DbRow): "timeout" | "failure" | null {
  const status = String(row.status ?? "succeeded");
  const error = `${row.error_code ?? ""} ${row.error_message ?? ""}`.toLowerCase();
  if (status === "succeeded") return null;
  if (error.includes("timeout") || error.includes("timed out")) return "timeout";
  return "failure";
}

export async function getCredentialHealth(
  client: SupabaseClient,
  credentialId: string,
): Promise<CredentialHealth> {
  const [ledgerToday, ledgerMonth, events, credential] = await Promise.all([
    client
      .from("ai_cost_ledger_entries")
      .select("actual_cost_usd, estimated_cost_usd, status, error_code, error_message")
      .eq("provider_credential_id", credentialId)
      .gte("created_at", dayStartIso()),
    client
      .from("ai_cost_ledger_entries")
      .select("actual_cost_usd, estimated_cost_usd")
      .eq("provider_credential_id", credentialId)
      .gte("created_at", monthStartIso()),
    client
      .from("platform_provider_credential_events")
      .select("event_type")
      .eq("credential_id", credentialId)
      .gte("created_at", dayStartIso()),
    client
      .from("platform_provider_credentials")
      .select("id, last_success_at, last_failure_at")
      .eq("id", credentialId)
      .maybeSingle(),
  ]);

  for (const res of [ledgerToday, ledgerMonth, events, credential]) {
    if (res.error) throw res.error;
  }

  const todayRows = (ledgerToday.data as DbRow[] | null) ?? [];
  const monthRows = (ledgerMonth.data as DbRow[] | null) ?? [];
  const eventRows = (events.data as DbRow[] | null) ?? [];
  const requestsToday = todayRows.length + eventRows.filter((e) => e.event_type === "used").length;
  const requestsMonth = monthRows.length;
  const costTodayUsd = todayRows.reduce(
    (sum, row) => sum + Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0),
    0,
  );
  const costMonthUsd = monthRows.reduce(
    (sum, row) => sum + Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0),
    0,
  );
  let successCount = todayRows.filter((row) => String(row.status ?? "succeeded") === "succeeded").length;
  let failureCount = 0;
  let timeoutCount = 0;
  for (const row of todayRows) {
    const failure = classifyFailure(row);
    if (failure === "timeout") timeoutCount += 1;
    if (failure) failureCount += 1;
  }
  successCount += eventRows.filter((e) => e.event_type === "used" || e.event_type === "tested").length;
  failureCount += eventRows.filter((e) => e.event_type === "failed").length;
  const fallbackCount = eventRows.filter((e) => e.event_type === "fallback_used").length;
  const denominator = Math.max(1, successCount + failureCount + fallbackCount);

  return {
    credentialId,
    requestsToday,
    requestsMonth,
    costTodayUsd,
    costMonthUsd,
    successCount,
    failureCount,
    timeoutCount,
    fallbackCount,
    errorRate: failureCount / denominator,
    timeoutRate: timeoutCount / denominator,
    fallbackRate: fallbackCount / denominator,
    lastSuccessAt: credential.data?.last_success_at ? String(credential.data.last_success_at) : undefined,
    lastFailureAt: credential.data?.last_failure_at ? String(credential.data.last_failure_at) : undefined,
  };
}

export function isHealthy(health: CredentialHealth): boolean {
  const sampleCount = health.successCount + health.failureCount + health.fallbackCount;
  if (sampleCount < 5) return true;
  return health.errorRate < 0.2 && health.timeoutRate < 0.2;
}

export async function getProviderHealthMap(
  client: SupabaseClient,
  provider: ManagedProviderId,
): Promise<Map<string, CredentialHealth>> {
  const { data, error } = await client
    .from("platform_provider_credentials")
    .select("id")
    .eq("provider", provider);
  if (error) throw error;
  const map = new Map<string, CredentialHealth>();
  for (const row of (data as DbRow[] | null) ?? []) {
    const id = String(row.id);
    map.set(id, await getCredentialHealth(client, id));
  }
  return map;
}
