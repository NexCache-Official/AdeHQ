import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUsagePeriodRange } from "@/lib/ai/work-hours/periods";
import {
  INTELLIGENCE_MODE_LABELS,
  intelligenceModeFromModelMode,
  type IntelligenceMode,
} from "@/lib/ai/intelligence-policy";
import { formatWorkTypeLabel } from "@/lib/work-hours/labels";
import { floorDisplayHours, floorDisplayLeafHours, floorDisplayTree } from "./round-display";
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

function intelligenceLabel(key: string): string {
  if (key === "unspecified") return "Unspecified intelligence";
  const mode = key as IntelligenceMode;
  const base = INTELLIGENCE_MODE_LABELS[mode] ?? formatWorkTypeLabel(key);
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

  // Lean projection only — selecting `metadata` jsonb has returned empty
  // `data: []` with count>0 for some SaaS workspaces (payload/serialize),
  // which blanked hire breakdowns while the period counter still moved.
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
      .select("id, name, system_employee_key, is_system_employee, model_mode, intelligence_policy")
      .eq("workspace_id", workspaceId),
  ]);
  // If intelligence_policy projection fails, retry names-only so hire rows
  // do not collapse to the generic "AI employee" label.
  type EmployeeRow = {
    id: string;
    name: string;
    system_employee_key?: string | null;
    is_system_employee?: boolean | null;
    model_mode?: string | null;
    intelligence_policy?: { defaultMode?: string } | null;
  };
  let employeeRows = (employeesRes.data ?? []) as EmployeeRow[];
  if (employeesRes.error || employeeRows.length === 0) {
    const retry = await client
      .from("ai_employees")
      .select("id, name, system_employee_key, is_system_employee, model_mode")
      .eq("workspace_id", workspaceId);
    if (!retry.error && retry.data?.length) {
      employeeRows = retry.data as EmployeeRow[];
    }
  }

  const ledgerRows: {
    data: LedgerRow[] | null;
    error: { message?: string } | null;
  } = ledgerRes as { data: LedgerRow[] | null; error: { message?: string } | null };

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

  if (ledgerRows.error) {
    console.error("[AdeHQ usage] ledger query failed", ledgerRows.error);
    // Period counter is still authoritative for the rail meter — never blank
    // the UI to 0.00 when applyCostToPeriod has already recorded usage.
    const fallbackUsed = floorDisplayHours(capacity.used);
    return {
      ...empty,
      totalWorkHours: fallbackUsed,
      teamWorkHours: fallbackUsed,
      capacity: syncCapacityToDisplayedUsed(capacity, fallbackUsed),
    };
  }

  const rows = (ledgerRows.data as LedgerRow[] | null) ?? [];
  if (rows.length === 0 && capacity.used > 0) {
    console.warn("[AdeHQ usage] ledger empty but period has usage", {
      workspaceId,
      periodUsed: capacity.used,
      startIso,
      endExclusiveIso,
    });
  }
  const employees = employeeRows;

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

  // Floor leaves first, then roll parents up as sums so hire rows always equal hire total
  // and hire + guide always equals the period total (never round individual rows up).
  const byEmployeeWorkType: EmployeeWorkTypeBreakdown[] = [...matrix.entries()]
    .map(([employeeId, byIntel]) => {
      const byIntelligence: IntelligenceWorkTypeBreakdown[] = [...byIntel.entries()]
        .map(([intelKey, byType]) => {
          const { rows: byWorkType, total: intelHours } = floorDisplayTree(
            [...byType.entries()].map(([key, hours]) => ({
              key,
              label: formatWorkTypeLabel(key),
              workHours: hours,
            })),
          );
          return {
            key: intelKey,
            label: intelligenceLabel(intelKey),
            workHours: intelHours,
            byWorkType: byWorkType.sort((a, b) => b.workHours - a.workHours),
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

      const workHours = byIntelligence.reduce((s, n) => s + n.workHours, 0);
      return {
        employeeId,
        label: employeeLabel(employeeId),
        workHours,
        byIntelligence,
        byWorkType: [...workTypeRollup.entries()]
          .map(([key, hours]) => ({
            key,
            label: formatWorkTypeLabel(key),
            workHours: hours,
          }))
          .filter((row) => row.workHours > 0)
          .sort((a, b) => b.workHours - a.workHours),
      };
    })
    .filter((row) => row.workHours > 0)
    .sort((a, b) => b.workHours - a.workHours || a.label.localeCompare(b.label));

  if (rows.length > 0 && totalWorkHours <= 0) {
    console.warn("[AdeHQ usage] ledger rows present but no billable hours aggregated", {
      workspaceId,
      rowCount: rows.length,
      sample: rows.slice(0, 3).map((row) => ({
        employee_id: row.employee_id,
        work_hours_charged: row.work_hours_charged,
        billable_to_workspace: row.billable_to_workspace,
        status: row.status,
      })),
    });
  }

  const teamWorkHoursRaw = [...employeeAgg.values()].reduce((sum, row) => sum + row.workHours, 0);
  const guideWorkHoursRaw = Math.max(0, totalWorkHours - teamWorkHoursRaw);
  // Floor the period total from raw ledger hours first — leaf-first flooring can
  // zero many sub-cent shards and leave the rail meter stuck at 0.00.
  // If the ledger select returns no billable rows but the period counter moved
  // (writes succeeded), prefer the period total so Usage cannot stay at 0.00.
  const totalDisplay = floorDisplayHours(
    totalWorkHours > 0 ? totalWorkHours : Math.max(totalWorkHours, capacity.used),
  );
  const teamDisplay = Math.min(
    totalDisplay,
    floorDisplayHours(
      teamWorkHoursRaw > 0
        ? teamWorkHoursRaw
        : // Ledger empty but period moved — attribute the fallback to hire team
          totalWorkHours <= 0 && totalDisplay > 0
          ? totalDisplay
          : teamWorkHoursRaw,
    ),
  );
  const guideDisplay = Math.max(
    0,
    Math.round((totalDisplay - teamDisplay) * 100) / 100,
  );

  const byEmployee = toRows(employeeAgg, employeeLabel).map((row) => ({
    ...row,
    workHours: floorDisplayLeafHours(row.workHours),
  })).filter((row) => row.workHours > 0);
  // Reconcile flat employee list to the same hire total (sum of floored rows).
  const byEmployeeAligned = alignFlatRowsToTotal(byEmployee, teamDisplay);

  const byWorkType = toRows(workTypeAgg, formatWorkTypeLabel).map((row) => ({
    ...row,
    workHours: floorDisplayLeafHours(row.workHours),
  })).filter((row) => row.workHours > 0);
  const byWorkTypeAligned = alignFlatRowsToTotal(byWorkType, totalDisplay);

  const capacitySynced = syncCapacityToDisplayedUsed(capacity, totalDisplay);

  return {
    capacity: capacitySynced,
    weekStart,
    totalWorkHours: totalDisplay,
    teamWorkHours: teamDisplay,
    guideWorkHours: guideDisplay,
    byEmployee: byEmployeeAligned,
    byWorkType: byWorkTypeAligned,
    byEmployeeWorkType,
    byProvider: toRows(providerAgg, (p) => p).map((row) => ({
      ...row,
      workHours: floorDisplayHours(row.workHours),
    })),
    byModel: toRows(modelAgg, (m) => m).map((row) => ({
      ...row,
      workHours: floorDisplayHours(row.workHours),
    })),
    totalCostUsd: includeCost ? Math.round(totalCostUsd * 10000) / 10000 : 0,
    totalTokens,
    failedRunWasteUsd: includeCost ? Math.round(failedRunWasteUsd * 10000) / 10000 : 0,
  };
}

/** If floored flat rows overshoot the rolled tree total, trim from the largest rows. */
function alignFlatRowsToTotal(
  rows: UsageBreakdownRow[],
  target: number,
): UsageBreakdownRow[] {
  const targetCents = Math.round(target * 100);
  let sumCents = rows.reduce((s, r) => s + Math.round(r.workHours * 100), 0);
  if (sumCents <= targetCents) return rows;
  const next = rows.map((r) => ({ ...r }));
  const order = next
    .map((r, i) => ({ i, hours: r.workHours }))
    .sort((a, b) => b.hours - a.hours || a.i - b.i);
  for (const { i } of order) {
    if (sumCents <= targetCents) break;
    const cents = Math.round(next[i]!.workHours * 100);
    if (cents <= 0) continue;
    next[i] = { ...next[i]!, workHours: (cents - 1) / 100 };
    sumCents -= 1;
  }
  return next.filter((r) => r.workHours > 0);
}

function syncCapacityToDisplayedUsed(
  capacity: WorkspaceCapacity,
  usedDisplay: number,
): WorkspaceCapacity {
  const used = floorDisplayHours(usedDisplay);
  if (capacity.unlimited) {
    return { ...capacity, used, warningLevel: "ok" };
  }
  // Remaining from the same displayed used so meters cannot disagree.
  const remaining = Math.max(0, Math.round((capacity.allowance - used) * 100) / 100);
  let warningLevel: WorkspaceCapacity["warningLevel"] = "ok";
  if (remaining <= 0) warningLevel = "exhausted";
  else if (capacity.allowance > 0 && remaining <= capacity.allowance * 0.15) {
    warningLevel = "low";
  }
  return {
    ...capacity,
    used,
    remaining,
    warningLevel,
  };
}

