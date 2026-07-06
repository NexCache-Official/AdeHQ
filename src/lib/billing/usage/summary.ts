import type { SupabaseClient } from "@supabase/supabase-js";
import { getBillingWeekRangeIso, getBillingWeekStart } from "@/lib/ai/work-hours/periods";
import { displayWorkHours } from "@/lib/billing/costing/work-hours";
import { getWorkspaceCapacity, type WorkspaceCapacity } from "./periods";

export type UsageBreakdownRow = {
  key: string;
  label: string;
  workHours: number;
  costUsd: number;
};

export type WorkspaceUsageSummary = {
  capacity: WorkspaceCapacity;
  weekStart: string;
  totalWorkHours: number;
  byEmployee: UsageBreakdownRow[];
  byWorkType: UsageBreakdownRow[];
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

/**
 * Aggregate the current week's billable cost ledger for a workspace.
 * `includeCost` controls whether raw USD figures are populated (admin only);
 * customer surfaces should pass false and read Work Hours.
 */
export async function summarizeWorkspaceUsage(
  client: SupabaseClient,
  workspaceId: string,
  options: { includeCost?: boolean } = {},
): Promise<WorkspaceUsageSummary> {
  const includeCost = options.includeCost ?? false;
  const weekStart = getBillingWeekStart(new Date());
  const { startIso, endExclusiveIso } = getBillingWeekRangeIso(weekStart);

  const [capacity, ledgerRes] = await Promise.all([
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
  ]);

  if (ledgerRes.error) {
    // Ledger table may be missing on older environments — return capacity only.
    return {
      capacity,
      weekStart,
      totalWorkHours: 0,
      byEmployee: [],
      byWorkType: [],
      byProvider: [],
      byModel: [],
      totalCostUsd: 0,
      totalTokens: 0,
      failedRunWasteUsd: 0,
    };
  }

  const rows = (ledgerRes.data as LedgerRow[] | null) ?? [];

  const employeeAgg = new Map<string, { workHours: number; costUsd: number }>();
  const workTypeAgg = new Map<string, { workHours: number; costUsd: number }>();
  const providerAgg = new Map<string, { workHours: number; costUsd: number }>();
  const modelAgg = new Map<string, { workHours: number; costUsd: number }>();

  let totalWorkHours = 0;
  let totalCostUsd = 0;
  let totalTokens = 0;
  let failedRunWasteUsd = 0;

  const bump = (
    map: Map<string, { workHours: number; costUsd: number }>,
    key: string,
    workHours: number,
    costUsd: number,
  ) => {
    const entry = map.get(key) ?? { workHours: 0, costUsd: 0 };
    entry.workHours += workHours;
    entry.costUsd += costUsd;
    map.set(key, entry);
  };

  for (const row of rows) {
    const workHours = Number(row.work_hours_charged ?? 0);
    const costUsd = Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
    totalTokens += Number(row.total_tokens ?? 0);

    if (row.status === "failed") failedRunWasteUsd += costUsd;

    if (row.billable_to_workspace === false) continue;

    totalWorkHours += workHours;
    totalCostUsd += costUsd;

    if (row.employee_id) bump(employeeAgg, row.employee_id, workHours, costUsd);
    bump(workTypeAgg, row.work_type ?? "other", workHours, costUsd);
    bump(providerAgg, row.provider_route ?? row.provider_name ?? "unknown", workHours, costUsd);
    if (row.model_id) bump(modelAgg, row.model_id, workHours, costUsd);
  }

  // Resolve employee names.
  const employeeIds = [...employeeAgg.keys()];
  const nameById = new Map<string, string>();
  if (employeeIds.length) {
    const { data: employees } = await client
      .from("ai_employees")
      .select("id, name")
      .in("id", employeeIds);
    for (const emp of employees ?? []) nameById.set(String(emp.id), String(emp.name));
  }

  const toRows = (
    map: Map<string, { workHours: number; costUsd: number }>,
    labelFor: (key: string) => string,
  ): UsageBreakdownRow[] =>
    [...map.entries()]
      .map(([key, value]) => ({
        key,
        label: labelFor(key),
        workHours: displayWorkHours(value.workHours),
        costUsd: includeCost ? Math.round(value.costUsd * 10000) / 10000 : 0,
      }))
      .sort((a, b) => b.workHours - a.workHours);

  return {
    capacity,
    weekStart,
    totalWorkHours: displayWorkHours(totalWorkHours),
    byEmployee: toRows(employeeAgg, (id) => nameById.get(id) ?? "AI employee"),
    byWorkType: toRows(workTypeAgg, humanizeWorkType),
    byProvider: toRows(providerAgg, (p) => p),
    byModel: toRows(modelAgg, (m) => m),
    totalCostUsd: includeCost ? Math.round(totalCostUsd * 10000) / 10000 : 0,
    totalTokens,
    failedRunWasteUsd: includeCost ? Math.round(failedRunWasteUsd * 10000) / 10000 : 0,
  };
}
