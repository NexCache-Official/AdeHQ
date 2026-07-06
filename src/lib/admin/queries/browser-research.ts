import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AGGREGATION_ROW_LIMIT,
  groupSum,
  rangeStart,
  sumBy,
  type AdminRange,
} from "./helpers";

export type BrowserResearchSummary = {
  range: AdminRange;
  totals: {
    runs: number;
    completed: number;
    failed: number;
    cancelled: number;
    running: number;
    avgDurationSeconds: number | null;
    totalCostUsd: number;
    avgCostUsd: number | null;
  };
  byProvider: { key: string; runs: number; costUsd: number }[];
  byWorkspace: { key: string; label: string; runs: number; costUsd: number }[];
  /** Metadata only — never includes query text, screenshots, or findings. */
  recentFailures: {
    id: string;
    workspaceName: string;
    provider: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
  }[];
};

export async function getBrowserResearchSummary(
  client: SupabaseClient,
  range: AdminRange,
): Promise<BrowserResearchSummary> {
  const since = rangeStart(range);

  const [runsRes, workspacesRes] = await Promise.all([
    client
      .from("browser_research_runs")
      .select(
        "id, workspace_id, status, provider, estimated_cost_usd, error_message, started_at, completed_at, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(AGGREGATION_ROW_LIMIT),
    client.from("workspaces").select("id, name").limit(AGGREGATION_ROW_LIMIT),
  ]);

  if (runsRes.error) throw runsRes.error;
  if (workspacesRes.error) throw workspacesRes.error;

  const runs = runsRes.data ?? [];
  const workspaceNameById = new Map(
    (workspacesRes.data ?? []).map((w) => [w.id, w.name]),
  );

  const costOf = (r: (typeof runs)[number]) => Number(r.estimated_cost_usd ?? 0);

  const durations = runs
    .filter((r) => r.started_at && r.completed_at)
    .map(
      (r) =>
        (new Date(r.completed_at!).getTime() - new Date(r.started_at!).getTime()) / 1000,
    )
    .filter((seconds) => seconds >= 0);

  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const cancelled = runs.filter((r) => r.status === "cancelled").length;
  const running = runs.filter(
    (r) => r.status === "running" || r.status === "created" || r.status === "planning",
  ).length;
  const totalCost = sumBy(runs, costOf);

  return {
    range,
    totals: {
      runs: runs.length,
      completed,
      failed,
      cancelled,
      running,
      avgDurationSeconds: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
      totalCostUsd: Math.round(totalCost * 10000) / 10000,
      avgCostUsd: runs.length
        ? Math.round((totalCost / runs.length) * 10000) / 10000
        : null,
    },
    byProvider: groupSum(runs, (r) => r.provider ?? "unknown", costOf).map(
      ({ key, value, count }) => ({
        key,
        runs: count,
        costUsd: Math.round(value * 10000) / 10000,
      }),
    ),
    byWorkspace: groupSum(runs, (r) => r.workspace_id, costOf)
      .slice(0, 15)
      .map(({ key, value, count }) => ({
        key,
        label: workspaceNameById.get(key) ?? key,
        runs: count,
        costUsd: Math.round(value * 10000) / 10000,
      })),
    recentFailures: runs
      .filter((r) => r.status === "failed")
      .slice(0, 20)
      .map((r) => ({
        id: r.id,
        workspaceName: workspaceNameById.get(r.workspace_id) ?? r.workspace_id,
        provider: r.provider ?? "unknown",
        status: r.status,
        errorMessage: r.error_message ? String(r.error_message).slice(0, 200) : null,
        createdAt: r.created_at,
      })),
  };
}
