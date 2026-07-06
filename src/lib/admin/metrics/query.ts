import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_METRIC_DEFINITIONS, type AdminMetricDefinition } from "./definitions";
import { parseAdminRange, rangeStartIso, type AdminRange } from "./ranges";
import type { WorkspaceFilterOptions } from "../workspace-filters";
import { filterWorkspaceIds } from "../workspace-filters";
import { getOverviewSummary } from "../queries/overview";
import { getGrowthSummary } from "../queries/growth";
import { getUsageSummary } from "../queries/usage";
import { getWorkHoursSummary } from "../queries/work-hours";

export type MetricQueryOptions = {
  range?: AdminRange;
  filters?: WorkspaceFilterOptions;
  useRollups?: boolean;
};

export type MetricResult = {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  description: string;
  privacyLevel: AdminMetricDefinition["privacyLevel"];
};

export type AdminApiMeta = {
  range: AdminRange;
  filters: WorkspaceFilterOptions;
  generatedAt: string;
  privacyLevel: "public_operational" | "internal_metadata";
  useRollups: boolean;
};

export function buildMeta(opts: MetricQueryOptions): AdminApiMeta {
  return {
    range: opts.range ?? "7d",
    filters: opts.filters ?? {},
    generatedAt: new Date().toISOString(),
    privacyLevel: "public_operational",
    useRollups: opts.useRollups ?? false,
  };
}

/** Rollup-aware metric interface — Stage 1 uses live aggregates only. */
export async function getMetric(
  client: SupabaseClient,
  key: string,
  opts: MetricQueryOptions = {},
): Promise<MetricResult | null> {
  const def = ADMIN_METRIC_DEFINITIONS[key];
  if (!def) return null;

  const range = opts.range ?? "7d";

  if (opts.useRollups) {
    const { data } = await client
      .from("platform_metric_daily_rollups")
      .select("value")
      .eq("metric_key", key)
      .eq("scope_type", "global")
      .gte("date", rangeStartIso(range).slice(0, 10))
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        key,
        label: def.label,
        value: Number(data.value),
        description: def.description,
        privacyLevel: def.privacyLevel,
      };
    }
  }

  const overview = await getOverviewSummary(client, range);
  const valueMap: Record<string, number | string | null> = {
    new_signups: overview.signups.week,
    active_workspaces: overview.workspaces.activeInRange,
    ai_cost: overview.usage.totalCostUsd,
    work_hours_used: overview.workHours.totalHours,
    browser_runs: overview.browserRunsInRange,
    failed_ai_runs: overview.usage.failedCount,
  };

  return {
    key,
    label: def.label,
    value: valueMap[key] ?? null,
    description: def.description,
    privacyLevel: def.privacyLevel,
  };
}

export async function getMetrics(
  client: SupabaseClient,
  keys: string[],
  opts: MetricQueryOptions = {},
): Promise<MetricResult[]> {
  const results = await Promise.all(keys.map((key) => getMetric(client, key, opts)));
  return results.filter((r): r is MetricResult => r != null);
}

export async function loadWorkspaceFilterSet(
  client: SupabaseClient,
  filters: WorkspaceFilterOptions,
): Promise<Set<string> | null> {
  const { data, error } = await client
    .from("workspaces")
    .select("id, workspace_mode, is_internal, is_test, status");
  if (error) throw error;
  const allIncluded =
    filters.includeInternal &&
    filters.includeTest &&
    filters.includeDemo &&
    filters.includeDisabled;
  if (allIncluded) return null;
  return filterWorkspaceIds(data ?? [], filters);
}

/** Copilot-ready bundle for Stage 5. */
export async function getPlatformInsights(
  client: SupabaseClient,
  range: AdminRange = "7d",
): Promise<{
  overview: Awaited<ReturnType<typeof getOverviewSummary>>;
  growth: Awaited<ReturnType<typeof getGrowthSummary>>;
  usageByProvider: Awaited<ReturnType<typeof getUsageSummary>>;
  workHours: Awaited<ReturnType<typeof getWorkHoursSummary>>;
}> {
  const [overview, growth, usageByProvider, workHours] = await Promise.all([
    getOverviewSummary(client, range),
    getGrowthSummary(client, range),
    getUsageSummary(client, range, "provider"),
    getWorkHoursSummary(client, range),
  ]);
  return { overview, growth, usageByProvider, workHours };
}

export function parseMetricRange(raw: string | null): AdminRange {
  return parseAdminRange(raw);
}
