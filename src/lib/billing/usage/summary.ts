import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUsagePeriodRange } from "@/lib/ai/work-hours/periods";
import { displayWorkHours } from "@/lib/billing/costing/work-hours";
import { getWorkspaceCapacity, type WorkspaceCapacity } from "./periods";

export type UsageBreakdownRow = {
  key: string;
  label: string;
  workHours: number;
  costUsd: number;
};

export type EmployeeWorkTypeBreakdown = {
  employeeId: string;
  label: string;
  workHours: number;
  byWorkType: Array<{ key: string; label: string; workHours: number }>;
};

export type WorkspaceUsageSummary = {
  capacity: WorkspaceCapacity;
  weekStart: string;
  totalWorkHours: number;
  /** Hired-employee hours only (excludes Maya / guide). */
  teamWorkHours: number;
  /** Maya / guide hours included in the period total but not the hire list. */
  guideWorkHours: number;
  byEmployee: UsageBreakdownRow[];
  byWorkType: UsageBreakdownRow[];
  /** Nested employee → work-type breakdown (excludes Maya). */
  byEmployeeWorkType: EmployeeWorkTypeBreakdown[];
  byProvider: UsageBreakdownRow[];
  byModel: UsageBreakdownRow[];
  totalCostUsd: number;
  totalTokens: number;
  failedRunWasteUsd: number;
};

type LedgerRow = {
  employee_id: string | null;
  work_type: string | null;
  provider_route: string | null;
  provider_name: string | null;
  model_id: string | null;
  work_hours_charged: number | null;
  actual_cost_usd: number | null;
  estimated_cost_usd: number | null;
  total_tokens: number | null;
  status: string | null;
  billable_to_workspace: boolean | null;
};

function humanizeWorkType(workType: string): string {
  return workType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function bump(
  map: Map<string, { workHours: number; costUsd: number }>,
  key: string,
  workHours: number,
  costUsd: number,
) {
  const entry = map.get(key) ?? { workHours: 0, costUsd: 0 };
  entry.workHours += workHours;
  entry.costUsd += costUsd;
  map.set(key, entry);
}

/**
 * Aggregate the current period's billable cost ledger for a workspace
 * (Mon 00:00 UTC week, clipped by calendar month).
 * `includeCost` controls whether raw USD figures are populated (admin only);
 * customer surfaces should pass false and read Work Hours.
 */
export async function summarizeWorkspaceUsage(
  client: SupabaseClient,
  workspaceId: string,
  options: { includeCost?: boolean } = {},
): Promise<WorkspaceUsageSummary> {
  const includeCost = options.includeCost ?? false;
  const { weekStart, startIso, endExclusiveIso } = getCurrentUsagePeriodRange(new Date());

  const [capacity, ledgerRes, employeesRes] = await Promise.all([
    getWorkspaceCapacity(client, workspaceId),
    client
      .from("ai_cost_ledger_entries")
      .select(
        "employee_id, work_type, provider_route, provider_name, model_id, work_hours_charged, actual_cost_usd, estimated_cost_usd, total_tokens, status, billable_to_workspace",
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", startIso)
      .lt("created_at", endExclusiveIso)
      .limit(5000),
    client
      .from("ai_employees")
      .select("id, name, system_employee_key, is_system_employee")
      .eq("workspace_id", workspaceId),
  ]);

  const empty: WorkspaceUsageSummary = {
    capacity,
    weekStart,
    totalWorkHours: 0,
    teamWorkHours: 0,
    guideWorkHours: 0,
    byEmployee: [],
    byWorkType: [],
    byEmployeeWorkType: [],
    byProvider: [],
    byModel: [],
    totalCostUsd: 0,
    totalTokens: 0,
    failedRunWasteUsd: 0,
  };

  if (ledgerRes.error) {
    return empty;
  }

  const rows = (ledgerRes.data as LedgerRow[] | null) ?? [];
  const employees = (employeesRes.data ?? []) as Array<{
    id: string;
    name: string;
    system_employee_key?: string | null;
    is_system_employee?: boolean | null;
  }>;

  const nameById = new Map(employees.map((e) => [String(e.id), String(e.name)]));
  const isMaya = (e: { system_employee_key?: string | null; is_system_employee?: boolean | null; name: string }) =>
    e.system_employee_key === "maya" ||
    (Boolean(e.is_system_employee) && /maya/i.test(String(e.name)));
  const mayaIds = new Set(employees.filter(isMaya).map((e) => String(e.id)));
  const hiredEmployeeIds = employees.filter((e) => !isMaya(e)).map((e) => String(e.id));

  const employeeAgg = new Map<string, { workHours: number; costUsd: number }>();
  const workTypeAgg = new Map<string, { workHours: number; costUsd: number }>();
  const providerAgg = new Map<string, { workHours: number; costUsd: number }>();
  const modelAgg = new Map<string, { workHours: number; costUsd: number }>();
  /** employeeId → workType → hours (hired team only; Maya excluded) */
  const matrix = new Map<string, Map<string, number>>();
  for (const id of hiredEmployeeIds) {
    matrix.set(id, new Map());
    employeeAgg.set(id, { workHours: 0, costUsd: 0 });
  }

  let totalWorkHours = 0;
  let totalCostUsd = 0;
  let totalTokens = 0;
  let failedRunWasteUsd = 0;
  for (const row of rows) {
    const workHours = Number(row.work_hours_charged ?? 0);
    const costUsd = Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
    totalTokens += Number(row.total_tokens ?? 0);

    if (row.status === "failed") failedRunWasteUsd += costUsd;
    if (row.billable_to_workspace === false) continue;
    if (!Number.isFinite(workHours) || workHours <= 0) continue;

    const employeeId = row.employee_id ? String(row.employee_id) : "unassigned";
    const workType = row.work_type?.trim() || "other";

    totalWorkHours += workHours;
    totalCostUsd += costUsd;

    bump(workTypeAgg, workType, workHours, costUsd);
    bump(providerAgg, row.provider_route ?? row.provider_name ?? "unknown", workHours, costUsd);
    if (row.model_id) bump(modelAgg, row.model_id, workHours, costUsd);

    // Maya (guide) stays in the period total only — not the hire-team matrix.
    if (mayaIds.has(employeeId)) continue;

    bump(employeeAgg, employeeId, workHours, costUsd);
    const byType = matrix.get(employeeId) ?? new Map<string, number>();
    byType.set(workType, (byType.get(workType) ?? 0) + workHours);
    matrix.set(employeeId, byType);
  }

  const toRows = (
    map: Map<string, { workHours: number; costUsd: number }>,
    labelFor: (key: string) => string,
  ): UsageBreakdownRow[] =>
    [...map.entries()]
      .filter(([, value]) => value.workHours > 0)
      .map(([key, value]) => ({
        key,
        label: labelFor(key),
        // Keep enough precision that summed rows still match period total.
        workHours: Math.round(value.workHours * 10000) / 10000,
        costUsd: includeCost ? Math.round(value.costUsd * 10000) / 10000 : 0,
      }))
      .sort((a, b) => b.workHours - a.workHours);

  const employeeLabel = (id: string) => {
    if (id === "unassigned") return "Unassigned / system";
    return nameById.get(id) ?? "AI employee";
  };

  const byEmployeeWorkType: EmployeeWorkTypeBreakdown[] = [...matrix.entries()]
    .map(([employeeId, byType]) => {
      const rawTotal = [...byType.values()].reduce((s, n) => s + n, 0);
      return {
        employeeId,
        label: employeeLabel(employeeId),
        workHours: Math.round(rawTotal * 10000) / 10000,
        byWorkType: [...byType.entries()]
          .map(([key, hours]) => ({
            key,
            label: humanizeWorkType(key),
            workHours: Math.round(hours * 10000) / 10000,
          }))
          .sort((a, b) => b.workHours - a.workHours),
      };
    })
    // Active hours first; keep zero-hour hires visible so every hired employee is listed.
    .sort((a, b) => b.workHours - a.workHours || a.label.localeCompare(b.label));

  const teamWorkHoursRaw = byEmployeeWorkType.reduce((sum, row) => sum + row.workHours, 0);
  // Residual is Maya / guide (and any other excluded system hours).
  const guideWorkHours = Math.max(0, totalWorkHours - teamWorkHoursRaw);

  return {
    capacity,
    weekStart,
    totalWorkHours: displayWorkHours(totalWorkHours),
    teamWorkHours: displayWorkHours(teamWorkHoursRaw),
    guideWorkHours: displayWorkHours(guideWorkHours),
    byEmployee: toRows(employeeAgg, employeeLabel),
    byWorkType: toRows(workTypeAgg, humanizeWorkType),
    byEmployeeWorkType,
    byProvider: toRows(providerAgg, (p) => p),
    byModel: toRows(modelAgg, (m) => m),
    totalCostUsd: includeCost ? Math.round(totalCostUsd * 10000) / 10000 : 0,
    totalTokens,
    failedRunWasteUsd: includeCost ? Math.round(failedRunWasteUsd * 10000) / 10000 : 0,
  };
}
