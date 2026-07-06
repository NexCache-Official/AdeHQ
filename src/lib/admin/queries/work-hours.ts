import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkMinuteUsdRate, isWorkHoursShadowEnabled } from "@/lib/ai/work-hours/constants";
import {
  AGGREGATION_ROW_LIMIT,
  groupSum,
  rangeStart,
  sumBy,
  type AdminRange,
} from "./helpers";

export type WorkHoursSummary = {
  range: AdminRange;
  shadowEnabled: boolean;
  configuredUsdPerMinute: number;
  impliedUsdPerMinute: number | null;
  totals: {
    workMinutes: number;
    workHours: number;
    costUsd: number;
    entryCount: number;
  };
  byWorkspace: { key: string; label: string; minutes: number }[];
  byPlan: { key: string; minutes: number }[];
  byEmployee: { key: string; minutes: number }[];
  byWorkType: { key: string; minutes: number }[];
};

export async function getWorkHoursSummary(
  client: SupabaseClient,
  range: AdminRange,
): Promise<WorkHoursSummary> {
  const since = rangeStart(range);

  const [ledgerRes, workspacesRes] = await Promise.all([
    client
      .from("ai_work_minutes_ledger")
      .select(
        "workspace_id, employee_id, work_type, work_minutes_estimated, estimated_cost_usd, actual_cost_usd",
      )
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
    client.from("workspaces").select("id, name, plan").limit(AGGREGATION_ROW_LIMIT),
  ]);

  if (ledgerRes.error) throw ledgerRes.error;
  if (workspacesRes.error) throw workspacesRes.error;

  const ledger = ledgerRes.data ?? [];
  const workspaceById = new Map((workspacesRes.data ?? []).map((w) => [w.id, w]));

  const minutesOf = (r: (typeof ledger)[number]) => Number(r.work_minutes_estimated ?? 0);
  const costOf = (r: (typeof ledger)[number]) =>
    Number(r.actual_cost_usd ?? r.estimated_cost_usd ?? 0);

  const totalMinutes = sumBy(ledger, minutesOf);
  const totalCost = sumBy(ledger, costOf);

  const round2 = (v: number) => Math.round(v * 100) / 100;

  return {
    range,
    shadowEnabled: isWorkHoursShadowEnabled(),
    configuredUsdPerMinute: getWorkMinuteUsdRate(),
    impliedUsdPerMinute:
      totalMinutes > 0 ? Math.round((totalCost / totalMinutes) * 10000) / 10000 : null,
    totals: {
      workMinutes: round2(totalMinutes),
      workHours: round2(totalMinutes / 60),
      costUsd: Math.round(totalCost * 10000) / 10000,
      entryCount: ledger.length,
    },
    byWorkspace: groupSum(ledger, (r) => r.workspace_id, minutesOf)
      .slice(0, 20)
      .map(({ key, value }) => ({
        key,
        label: workspaceById.get(key)?.name ?? key,
        minutes: round2(value),
      })),
    byPlan: groupSum(
      ledger,
      (r) => workspaceById.get(r.workspace_id)?.plan ?? "unknown",
      minutesOf,
    ).map(({ key, value }) => ({ key, minutes: round2(value) })),
    byEmployee: groupSum(ledger, (r) => r.employee_id ?? "unassigned", minutesOf)
      .slice(0, 20)
      .map(({ key, value }) => ({ key, minutes: round2(value) })),
    byWorkType: groupSum(ledger, (r) => r.work_type ?? "unknown", minutesOf).map(
      ({ key, value }) => ({ key, minutes: round2(value) }),
    ),
  };
}
