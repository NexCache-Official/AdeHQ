import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AGGREGATION_ROW_LIMIT,
  effectiveCostUsd,
  groupSum,
  rangeStart,
  sumBy,
  type AdminRange,
} from "./helpers";

export type UsageGroupBy =
  | "provider"
  | "model"
  | "workspace"
  | "employee"
  | "work_type"
  | "plan"
  | "day";

export type UsageSummary = {
  range: AdminRange;
  groupBy: UsageGroupBy;
  totals: {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    eventCount: number;
    failedCount: number;
    blockedCount: number;
    fallbackCount: number;
    fallbackRate: number;
    workMinutes: number;
  };
  breakdown: { key: string; label: string; costUsd: number; count: number }[];
  failures: {
    provider: string;
    model: string;
    workspaceName: string;
    errorMessage: string | null;
    createdAt: string;
  }[];
};

export function parseGroupBy(raw: string | null): UsageGroupBy {
  const valid: UsageGroupBy[] = [
    "provider",
    "model",
    "workspace",
    "employee",
    "work_type",
    "plan",
    "day",
  ];
  return valid.includes(raw as UsageGroupBy) ? (raw as UsageGroupBy) : "provider";
}

export async function getUsageSummary(
  client: SupabaseClient,
  range: AdminRange,
  groupBy: UsageGroupBy,
): Promise<UsageSummary> {
  const since = rangeStart(range);

  const [eventsRes, ledgerRes, workspacesRes] = await Promise.all([
    client
      .from("ai_usage_events")
      .select(
        "workspace_id, employee_id, provider, model, status, fallback_used, input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, error_message, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("ai_work_minutes_ledger")
      .select("workspace_id, work_type, work_minutes_estimated, estimated_cost_usd, actual_cost_usd")
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client.from("workspaces").select("id, name, plan").limit(AGGREGATION_ROW_LIMIT),
  ]);

  for (const res of [eventsRes, ledgerRes, workspacesRes]) {
    if (res.error) throw res.error;
  }

  const events = eventsRes.data ?? [];
  const ledger = ledgerRes.data ?? [];
  const workspaceById = new Map(
    (workspacesRes.data ?? []).map((w) => [w.id, w]),
  );

  const failedCount = events.filter((e) => e.status === "failed").length;
  const blockedCount = events.filter((e) => e.status === "blocked").length;
  const fallbackCount = events.filter((e) => e.fallback_used).length;

  let breakdown: { key: string; label: string; costUsd: number; count: number }[];

  if (groupBy === "work_type") {
    breakdown = groupSum(
      ledger,
      (r) => r.work_type ?? "unknown",
      (r) => Number(r.actual_cost_usd ?? r.estimated_cost_usd ?? 0),
    ).map(({ key, value, count }) => ({
      key,
      label: key,
      costUsd: Math.round(value * 10000) / 10000,
      count,
    }));
  } else {
    const keyOf = (e: (typeof events)[number]): string => {
      switch (groupBy) {
        case "model":
          return e.model ?? "unknown";
        case "workspace":
          return e.workspace_id;
        case "employee":
          return e.employee_id ?? "unassigned";
        case "plan":
          return workspaceById.get(e.workspace_id)?.plan ?? "unknown";
        case "day":
          return (e.created_at ?? "").slice(0, 10);
        default:
          return e.provider ?? "unknown";
      }
    };
    breakdown = groupSum(events, keyOf, effectiveCostUsd).map(({ key, value, count }) => ({
      key,
      label: groupBy === "workspace" ? workspaceById.get(key)?.name ?? key : key,
      costUsd: Math.round(value * 10000) / 10000,
      count,
    }));
    if (groupBy === "day") {
      breakdown.sort((a, b) => a.key.localeCompare(b.key));
    }
  }

  const failures = events
    .filter((e) => e.status === "failed" || e.status === "blocked")
    .slice(0, 25)
    .map((e) => ({
      provider: e.provider ?? "unknown",
      model: e.model ?? "unknown",
      workspaceName: workspaceById.get(e.workspace_id)?.name ?? e.workspace_id,
      errorMessage: e.error_message ? String(e.error_message).slice(0, 200) : null,
      createdAt: e.created_at,
    }));

  return {
    range,
    groupBy,
    totals: {
      costUsd: Math.round(sumBy(events, effectiveCostUsd) * 10000) / 10000,
      inputTokens: sumBy(events, (e) => e.input_tokens),
      outputTokens: sumBy(events, (e) => e.output_tokens),
      eventCount: events.length,
      failedCount,
      blockedCount,
      fallbackCount,
      fallbackRate:
        events.length > 0 ? Math.round((fallbackCount / events.length) * 1000) / 10 : 0,
      workMinutes:
        Math.round(sumBy(ledger, (r) => Number(r.work_minutes_estimated)) * 100) / 100,
    },
    breakdown: breakdown.slice(0, 50),
    failures,
  };
}
