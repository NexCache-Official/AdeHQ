import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUsagePeriodRange } from "@/lib/ai/work-hours/periods";
import { displayWorkHours } from "@/lib/billing/costing/work-hours";

export type EmployeeUsageSummary = {
  employeeId: string;
  employeeName: string;
  hiredAt: string;
  weekWorkHours: number;
  lifetimeWorkHours: number;
  weekStart: string;
  weekEnd: string;
  periodStart: string;
  periodEnd: string;
};

async function sumBillableHours(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
  options: { gte?: string; lt?: string } = {},
): Promise<number> {
  let query = client
    .from("ai_cost_ledger_entries")
    .select("work_hours_charged, billable_to_workspace")
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employeeId)
    .limit(10000);

  if (options.gte) query = query.gte("created_at", options.gte);
  if (options.lt) query = query.lt("created_at", options.lt);

  const { data, error } = await query;
  if (error) throw error;

  let total = 0;
  for (const row of data ?? []) {
    if (row.billable_to_workspace === false) continue;
    const hours = Number(row.work_hours_charged ?? 0);
    if (Number.isFinite(hours) && hours > 0) total += hours;
  }
  return total;
}

/** This-period + lifetime Work Hours for one AI employee (commercial ledger). */
export async function summarizeEmployeeUsage(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
): Promise<EmployeeUsageSummary | null> {
  const { data: employee, error: employeeError } = await client
    .from("ai_employees")
    .select("id, name, created_at, workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("id", employeeId)
    .maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee) return null;

  const range = getCurrentUsagePeriodRange(new Date());
  const hiredAt = String(employee.created_at ?? new Date().toISOString());

  const [weekHours, lifetimeHours] = await Promise.all([
    sumBillableHours(client, workspaceId, employeeId, {
      gte: range.startIso,
      lt: range.endExclusiveIso,
    }),
    sumBillableHours(client, workspaceId, employeeId, {
      gte: hiredAt,
    }),
  ]);

  return {
    employeeId: String(employee.id),
    employeeName: String(employee.name),
    hiredAt,
    weekWorkHours: displayWorkHours(weekHours),
    lifetimeWorkHours: displayWorkHours(lifetimeHours),
    weekStart: range.weekStart,
    weekEnd: range.periodEndDate,
    periodStart: range.startIso,
    periodEnd: range.endExclusiveIso,
  };
}
