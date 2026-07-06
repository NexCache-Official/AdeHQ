import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AGGREGATION_ROW_LIMIT,
  countRows,
  daysAgoIso,
  effectiveCostUsd,
  groupSum,
  rangeStart,
  sumBy,
  type AdminRange,
} from "./helpers";

export type OverviewSummary = {
  range: AdminRange;
  signups: { today: number; week: number; month: number; total: number };
  workspaces: { total: number; activeInRange: number; disabled: number };
  aiEmployees: number;
  messagesInRange: number;
  browserRunsInRange: number;
  artifactsInRange: number;
  usage: {
    totalCostUsd: number;
    eventCount: number;
    failedCount: number;
    fallbackCount: number;
    byProvider: { key: string; value: number; count: number }[];
  };
  workHours: { totalMinutes: number; totalHours: number };
  recentAdminActions: {
    id: string;
    action: string;
    targetType: string | null;
    targetId: string | null;
    createdAt: string;
  }[];
  mrrPlaceholder: null;
};

export async function getOverviewSummary(
  client: SupabaseClient,
  range: AdminRange,
): Promise<OverviewSummary> {
  const since = rangeStart(range);

  const [
    signupsToday,
    signupsWeek,
    signupsMonth,
    signupsTotal,
    workspacesTotal,
    workspacesDisabled,
    aiEmployees,
    messagesInRange,
    browserRunsInRange,
    artifactsInRange,
    usageEventsRes,
    ledgerRes,
    auditRes,
  ] = await Promise.all([
    countRows(client, "profiles", (q) => q.gte("created_at", daysAgoIso(1))),
    countRows(client, "profiles", (q) => q.gte("created_at", daysAgoIso(7))),
    countRows(client, "profiles", (q) => q.gte("created_at", daysAgoIso(30))),
    countRows(client, "profiles"),
    countRows(client, "workspaces"),
    countRows(client, "workspaces", (q) => q.eq("status", "disabled")),
    countRows(client, "ai_employees", (q) => q.eq("is_system_employee", false)),
    countRows(client, "messages", (q) => q.gte("created_at", since)),
    countRows(client, "browser_research_runs", (q) => q.gte("created_at", since)),
    countRows(client, "artifacts", (q) => q.gte("created_at", since)),
    client
      .from("ai_usage_events")
      .select("workspace_id, provider, status, fallback_used, estimated_cost_usd, actual_cost_usd")
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("ai_work_minutes_ledger")
      .select("work_minutes_estimated")
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client
      .from("platform_admin_audit_logs")
      .select("id, action, target_type, target_id, created_at")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (usageEventsRes.error) throw usageEventsRes.error;
  if (ledgerRes.error) throw ledgerRes.error;
  if (auditRes.error) throw auditRes.error;

  const events = usageEventsRes.data ?? [];
  const activeWorkspaceIds = new Set(events.map((e) => e.workspace_id));
  const totalMinutes = sumBy(ledgerRes.data ?? [], (r) => Number(r.work_minutes_estimated));

  return {
    range,
    signups: {
      today: signupsToday,
      week: signupsWeek,
      month: signupsMonth,
      total: signupsTotal,
    },
    workspaces: {
      total: workspacesTotal,
      activeInRange: activeWorkspaceIds.size,
      disabled: workspacesDisabled,
    },
    aiEmployees,
    messagesInRange,
    browserRunsInRange,
    artifactsInRange,
    usage: {
      totalCostUsd: sumBy(events, effectiveCostUsd),
      eventCount: events.length,
      failedCount: events.filter((e) => e.status === "failed" || e.status === "blocked").length,
      fallbackCount: events.filter((e) => e.fallback_used).length,
      byProvider: groupSum(events, (e) => e.provider ?? "unknown", effectiveCostUsd).slice(0, 6),
    },
    workHours: {
      totalMinutes: Math.round(totalMinutes * 100) / 100,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    },
    recentAdminActions: (auditRes.data ?? []).map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      createdAt: row.created_at,
    })),
    mrrPlaceholder: null,
  };
}
