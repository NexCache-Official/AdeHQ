import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkMinuteUsdRate, isWorkHoursShadowEnabled } from "@/lib/ai/work-hours/constants";
import { displayWorkHours } from "@/lib/billing/costing/work-hours";
import {
  AGGREGATION_ROW_LIMIT,
  groupSum,
  rangeStart,
  sumBy,
  type AdminRange,
} from "./helpers";

export type WorkHoursSummary = {
  range: AdminRange;
  /** Commercial usage clock model (per-workspace 168h, not a global Monday week). */
  usageClock: {
    model: "activation_168h";
    description: string;
    workspacesWithAnchor: number;
    workspacesLegacyFallback: number;
    openPeriods: number;
    byClockKind: { free: number; paid: number; unknown: number };
  };
  /** Billable commercial WH charged in the selected admin range. */
  commercial: {
    totalWorkHours: number;
    mayaExemptWorkHours: number;
    entryCount: number;
    byEmployee: { key: string; label?: string; workHours: number }[];
    byWorkspace: { key: string; label: string; workHours: number }[];
  };
  /**
   * Shadow metering: measurement-only estimated minutes from AI cost.
   * Not what customers are billed — commercial WH uses ai_cost_ledger_entries.
   */
  shadow: {
    enabled: boolean;
    configuredUsdPerMinute: number;
    impliedUsdPerMinute: number | null;
    workMinutes: number;
    workHours: number;
    costUsd: number;
    entryCount: number;
    byWorkspace: { key: string; label: string; minutes: number }[];
    byPlan: { key: string; minutes: number }[];
    byEmployee: { key: string; minutes: number }[];
    byWorkType: { key: string; minutes: number }[];
  };
  /** @deprecated Prefer `commercial` — kept briefly for older admin clients. */
  currentPeriod?: {
    startIso: string;
    endExclusiveIso: string;
    weekStart: string;
    totalWorkHours: number;
    byEmployee: { key: string; label?: string; workHours: number }[];
    byWorkspace: { key: string; label: string; workHours: number }[];
  };
  /** @deprecated Prefer `shadow`. */
  shadowEnabled?: boolean;
  configuredUsdPerMinute?: number;
  impliedUsdPerMinute?: number | null;
  totals?: {
    workMinutes: number;
    workHours: number;
    costUsd: number;
    entryCount: number;
  };
  byWorkspace?: { key: string; label: string; minutes: number }[];
  byPlan?: { key: string; minutes: number }[];
  byEmployee?: { key: string; minutes: number }[];
  byWorkType?: { key: string; minutes: number }[];
};

export async function getWorkHoursSummary(
  client: SupabaseClient,
  range: AdminRange,
): Promise<WorkHoursSummary> {
  const since = rangeStart(range);

  const [ledgerRes, commercialRes, workspacesRes, employeesRes, openPeriodsRes] =
    await Promise.all([
      client
        .from("ai_work_minutes_ledger")
        .select(
          "workspace_id, employee_id, work_type, work_minutes_estimated, estimated_cost_usd, actual_cost_usd",
        )
        .gte("created_at", since)
        .limit(AGGREGATION_ROW_LIMIT),
      client
        .from("ai_cost_ledger_entries")
        .select(
          "workspace_id, employee_id, work_hours_charged, billable_to_workspace, created_at",
        )
        .gte("created_at", since)
        .limit(AGGREGATION_ROW_LIMIT),
      client
        .from("workspaces")
        .select("id, name, plan, usage_anchor_at, usage_clock_kind")
        .limit(AGGREGATION_ROW_LIMIT),
      client.from("ai_employees").select("id, name").limit(AGGREGATION_ROW_LIMIT),
      client
        .from("workspace_usage_periods")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .gt("period_end", new Date().toISOString()),
    ]);

  if (ledgerRes.error) throw ledgerRes.error;
  if (workspacesRes.error) throw workspacesRes.error;
  // Commercial ledger may be missing on older envs.
  const commercialRows = commercialRes.error ? [] : (commercialRes.data ?? []);
  const ledger = ledgerRes.data ?? [];
  const workspaces = workspacesRes.data ?? [];
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]));
  const employeeById = new Map(
    ((employeesRes.data ?? []) as Array<{ id: string; name: string }>).map((e) => [
      e.id,
      e.name,
    ]),
  );

  let withAnchor = 0;
  let legacy = 0;
  const byClockKind = { free: 0, paid: 0, unknown: 0 };
  for (const w of workspaces) {
    if (w.usage_anchor_at) withAnchor += 1;
    else legacy += 1;
    const kind = String(w.usage_clock_kind ?? "");
    if (kind === "free") byClockKind.free += 1;
    else if (kind === "paid") byClockKind.paid += 1;
    else byClockKind.unknown += 1;
  }

  const minutesOf = (r: (typeof ledger)[number]) => Number(r.work_minutes_estimated ?? 0);
  const costOf = (r: (typeof ledger)[number]) =>
    Number(r.actual_cost_usd ?? r.estimated_cost_usd ?? 0);

  const totalMinutes = sumBy(ledger, minutesOf);
  const totalCost = sumBy(ledger, costOf);
  const round2 = (v: number) => Math.round(v * 100) / 100;

  const billable = commercialRows.filter((r) => r.billable_to_workspace !== false);
  const mayaExempt = commercialRows.filter((r) => r.billable_to_workspace === false);
  const hoursOf = (r: { work_hours_charged?: number | null }) =>
    Number(r.work_hours_charged ?? 0);
  const commercialTotal = sumBy(billable, hoursOf);
  const mayaExemptTotal = sumBy(mayaExempt, hoursOf);

  const byEmployee = groupSum(billable, (r) => r.employee_id ?? "unassigned", hoursOf)
    .slice(0, 20)
    .map(({ key, value }) => ({
      key,
      label: employeeById.get(key) ?? key,
      workHours: displayWorkHours(value),
    }));
  const byWorkspace = groupSum(billable, (r) => r.workspace_id, hoursOf)
    .slice(0, 20)
    .map(({ key, value }) => ({
      key,
      label: workspaceById.get(key)?.name ?? key,
      workHours: displayWorkHours(value),
    }));

  const shadowByWorkspace = groupSum(ledger, (r) => r.workspace_id, minutesOf)
    .slice(0, 20)
    .map(({ key, value }) => ({
      key,
      label: workspaceById.get(key)?.name ?? key,
      minutes: round2(value),
    }));
  const shadowByPlan = groupSum(
    ledger,
    (r) => workspaceById.get(r.workspace_id)?.plan ?? "unknown",
    minutesOf,
  ).map(({ key, value }) => ({ key, minutes: round2(value) }));
  const shadowByEmployee = groupSum(ledger, (r) => r.employee_id ?? "unassigned", minutesOf)
    .slice(0, 20)
    .map(({ key, value }) => ({ key, minutes: round2(value) }));
  const shadowByWorkType = groupSum(ledger, (r) => r.work_type ?? "unknown", minutesOf).map(
    ({ key, value }) => ({ key, minutes: round2(value) }),
  );

  const shadowEnabled = isWorkHoursShadowEnabled();
  const configuredUsdPerMinute = getWorkMinuteUsdRate();
  const impliedUsdPerMinute =
    totalMinutes > 0 ? Math.round((totalCost / totalMinutes) * 10000) / 10000 : null;

  const commercial = {
    totalWorkHours: displayWorkHours(commercialTotal),
    mayaExemptWorkHours: displayWorkHours(mayaExemptTotal),
    entryCount: billable.length,
    byEmployee,
    byWorkspace,
  };

  const shadow = {
    enabled: shadowEnabled,
    configuredUsdPerMinute,
    impliedUsdPerMinute,
    workMinutes: round2(totalMinutes),
    workHours: round2(totalMinutes / 60),
    costUsd: Math.round(totalCost * 10000) / 10000,
    entryCount: ledger.length,
    byWorkspace: shadowByWorkspace,
    byPlan: shadowByPlan,
    byEmployee: shadowByEmployee,
    byWorkType: shadowByWorkType,
  };

  return {
    range,
    usageClock: {
      model: "activation_168h",
      description:
        "Each workspace has a 168-hour usage period anchored at paid activation (or workspace creation for Free). Independent of billing anniversary. Not Monday UTC / month-clipped.",
      workspacesWithAnchor: withAnchor,
      workspacesLegacyFallback: legacy,
      openPeriods: openPeriodsRes.count ?? 0,
      byClockKind,
    },
    commercial,
    shadow,
    // Back-compat aliases for any stale clients
    currentPeriod: {
      startIso: since,
      endExclusiveIso: new Date().toISOString(),
      weekStart: since,
      totalWorkHours: commercial.totalWorkHours,
      byEmployee,
      byWorkspace,
    },
    shadowEnabled,
    configuredUsdPerMinute,
    impliedUsdPerMinute,
    totals: {
      workMinutes: shadow.workMinutes,
      workHours: shadow.workHours,
      costUsd: shadow.costUsd,
      entryCount: shadow.entryCount,
    },
    byWorkspace: shadowByWorkspace,
    byPlan: shadowByPlan,
    byEmployee: shadowByEmployee,
    byWorkType: shadowByWorkType,
  };
}
