import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUsagePeriodRange } from "@/lib/ai/work-hours/periods";
import {
  INTELLIGENCE_MODE_LABELS,
  intelligenceModeFromModelMode,
  type IntelligenceMode,
} from "@/lib/ai/intelligence-policy";
import { displayWorkHours } from "@/lib/billing/costing/work-hours";
import { getWorkspaceCapacity, type WorkspaceCapacity } from "./periods";

export type UsageBreakdownRow = {
  key: string;
  label: string;
  workHours: number;
  costUsd: number;
};

export type IntelligenceWorkTypeBreakdown = {
  key: string;
  label: string;
  workHours: number;
  byWorkType: Array<{ key: string; label: string; workHours: number }>;
};

export type EmployeeWorkTypeBreakdown = {
  employeeId: string;
  label: string;
  workHours: number;
  /** Nested intelligence → work-type breakdown. */
  byIntelligence: IntelligenceWorkTypeBreakdown[];
  /** Flat work-type rollup (same hours as byIntelligence). */
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
  /** Nested employee → intelligence → work-type breakdown (excludes Maya). */
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
  metadata: Record<string, unknown> | null;
};

function humanizeWorkType(workType: string): string {
  return workType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function intelligenceLabel(key: string): string {
  if (key === "unspecified") return "Unspecified intelligence";
  const mode = key as IntelligenceMode;
  const base = INTELLIGENCE_MODE_LABELS[mode] ?? humanizeWorkType(key);
  return `${base} intelligence`;
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

function resolveIntelligenceKey(
  row: LedgerRow,
  employeeDefaultById: Map<string, string>,
): string {
  const meta = row.metadata ?? {};
  const fromMeta =
    (typeof meta.intelligenceMode === "string" && meta.intelligenceMode.trim()) ||
    (typeof meta.resolvedRunModelMode === "string" && meta.resolvedRunModelMode.trim()) ||
    (typeof meta.modelMode === "string" && meta.modelMode.trim()) ||
    null;
  if (fromMeta) return intelligenceModeFromModelMode(fromMeta);
  const employeeId = row.employee_id ? String(row.employee_id) : null;
  if (employeeId && employeeDefaultById.has(employeeId)) {
    return employeeDefaultById.get(employeeId)!;
  }
  return "unspecified";
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
        "employee_id, work_type, provider_route, provider_name, model_id, work_hours_charged, actual_cost_usd, estimated_cost_usd, total_tokens, status, billable_to_workspace, metadata",
      )
      .eq("workspace_id", workspaceId)
      .gte("created_at", startIso)
      .lt("created_at", endExclusiveIso)
      .limit(5000),
    client
      .from("ai_employees")
      .select("id, name, system_employee_key, is_system_employee, model_mode, intelligence_policy")
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
    model_mode?: string | null;
    intelligence_policy?: { defaultMode?: string } | null;
  }>;

  const nameById = new Map(employees.map((e) => [String(e.id), String(e.name)]));
  const isMaya = (e: {
    system_employee_key?: string | null;
    is_system_employee?: boolean | null;
    name: string;
  }) =>
    e.system_employee_key === "maya" ||
    (Boolean(e.is_system_employee) && /maya/i.test(String(e.name)));
  const mayaIds = new Set(employees.filter(isMaya).map((e) => String(e.id)));
  const hiredEmployeeIds = employees.filter((e) => !isMaya(e)).map((e) => String(e.id));

  const employeeDefaultById = new Map<string, string>();
  for (const e of employees) {
    const fromPolicy =
      typeof e.intelligence_policy?.defaultMode === "string"
        ? e.intelligence_policy.defaultMode
        : null;
    employeeDefaultById.set(
      String(e.id),
      intelligenceModeFromModelMode(fromPolicy ?? e.model_mode ?? "balanced"),
    );
  }

  const employeeAgg = new Map<string, { workHours: number; costUsd: number }>();
  const workTypeAgg = new Map<string, { workHours: number; costUsd: number }>();
  const providerAgg = new Map<string, { workHours: number; costUsd: number }>();
  const modelAgg = new Map<string, { workHours: number; costUsd: number }>();
  /** employeeId → intelligence → workType → hours */
  const matrix = new Map<string, Map<string, Map<string, number>>>();
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
    const intelligenceKey = resolveIntelligenceKey(row, employeeDefaultById);

    totalWorkHours += workHours;
    totalCostUsd += costUsd;

    bump(workTypeAgg, workType, workHours, costUsd);
    bump(providerAgg, row.provider_route ?? row.provider_name ?? "unknown", workHours, costUsd);
    if (row.model_id) bump(modelAgg, row.model_id, workHours, costUsd);

    if (mayaIds.has(employeeId)) continue;

    bump(employeeAgg, employeeId, workHours, costUsd);
    const byIntel = matrix.get(employeeId) ?? new Map<string, Map<string, number>>();
    const byType = byIntel.get(intelligenceKey) ?? new Map<string, number>();
    byType.set(workType, (byType.get(workType) ?? 0) + workHours);
    byIntel.set(intelligenceKey, byType);
    matrix.set(employeeId, byIntel);
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
        workHours: Math.round(value.workHours * 10000) / 10000,
        costUsd: includeCost ? Math.round(value.costUsd * 10000) / 10000 : 0,
      }))
      .sort((a, b) => b.workHours - a.workHours);

  const employeeLabel = (id: string) => {
    if (id === "unassigned") return "Unassigned / system";
    return nameById.get(id) ?? "AI employee";
  };

  const byEmployeeWorkType: EmployeeWorkTypeBreakdown[] = [...matrix.entries()]
    .map(([employeeId, byIntel]) => {
      const byIntelligence: IntelligenceWorkTypeBreakdown[] = [...byIntel.entries()]
        .map(([intelKey, byType]) => {
          const intelTotal = [...byType.values()].reduce((s, n) => s + n, 0);
          return {
            key: intelKey,
            label: intelligenceLabel(intelKey),
            workHours: Math.round(intelTotal * 10000) / 10000,
            byWorkType: [...byType.entries()]
              .map(([key, hours]) => ({
                key,
                label: humanizeWorkType(key),
                workHours: Math.round(hours * 10000) / 10000,
              }))
              .sort((a, b) => b.workHours - a.workHours),
          };
        })
        .filter((row) => row.workHours > 0)
        .sort((a, b) => b.workHours - a.workHours || a.label.localeCompare(b.label));

      const workTypeRollup = new Map<string, number>();
      for (const intel of byIntelligence) {
        for (const wt of intel.byWorkType) {
          workTypeRollup.set(wt.key, (workTypeRollup.get(wt.key) ?? 0) + wt.workHours);
        }
      }

      const rawTotal = byIntelligence.reduce((s, n) => s + n.workHours, 0);
      return {
        employeeId,
        label: employeeLabel(employeeId),
        workHours: Math.round(rawTotal * 10000) / 10000,
        byIntelligence,
        byWorkType: [...workTypeRollup.entries()]
          .map(([key, hours]) => ({
            key,
            label: humanizeWorkType(key),
            workHours: Math.round(hours * 10000) / 10000,
          }))
          .sort((a, b) => b.workHours - a.workHours),
      };
    })
    .sort((a, b) => b.workHours - a.workHours || a.label.localeCompare(b.label));

  const teamWorkHoursRaw = byEmployeeWorkType.reduce((sum, row) => sum + row.workHours, 0);
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
