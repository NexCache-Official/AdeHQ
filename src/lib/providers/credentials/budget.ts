import type { SupabaseClient } from "@supabase/supabase-js";
import { getCredentialHealth } from "./health";
import type { CredentialBudgetStatus, CredentialRow } from "./types";

function limitStatus(used: number, limit?: number | null): "under" | "near" | "over" {
  if (limit == null || limit <= 0) return "under";
  if (used >= limit) return "over";
  if (used / limit >= 0.85) return "near";
  return "under";
}

function maxStatus(...statuses: Array<"under" | "near" | "over">): "under" | "near" | "over" {
  if (statuses.includes("over")) return "over";
  if (statuses.includes("near")) return "near";
  return "under";
}

export async function getCredentialBudgetStatus(
  client: SupabaseClient,
  credential: CredentialRow,
): Promise<CredentialBudgetStatus> {
  const health = await getCredentialHealth(client, credential.id);
  const dailyCost = limitStatus(health.costTodayUsd, credential.daily_limit_usd);
  const monthlyCost = limitStatus(health.costMonthUsd, credential.monthly_limit_usd);
  const dailyRequests = limitStatus(health.requestsToday, credential.daily_limit_requests);
  const monthlyRequests = limitStatus(health.requestsMonth, credential.monthly_limit_requests);
  const status = maxStatus(dailyCost, monthlyCost, dailyRequests, monthlyRequests);
  const reason =
    status === "over"
      ? "Credential budget exceeded."
      : status === "near"
        ? "Credential budget near limit."
        : undefined;
  return {
    status,
    reason,
    costTodayUsd: health.costTodayUsd,
    costMonthUsd: health.costMonthUsd,
    requestsToday: health.requestsToday,
    requestsMonth: health.requestsMonth,
  };
}
