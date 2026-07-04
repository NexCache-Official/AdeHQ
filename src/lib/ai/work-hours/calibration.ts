import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCapabilityLabel, formatWorkTypeLabel } from "@/lib/work-hours/labels";
import { getWorkMinuteUsdRate, WORK_HOURS_SHADOW_MODE } from "./constants";
import { resolveShadowCostUsd } from "./estimate";
import type { ShadowWorkMinutesLedgerRow } from "./ledger";
import {
  getBillingMonthStart,
  getBillingWeekRangeIso,
  getBillingWeekStart,
} from "./periods";
import {
  evaluateWorkHoursSoftWarnings,
  assertNoForbiddenWorkHoursCopy,
  type WorkHoursSoftWarningsResult,
} from "./warnings";

export type CalibrationUsageRow = {
  id: string;
  workspaceId: string;
  employeeId?: string;
  provider: string;
  model: string;
  capability?: string;
  workUnitId?: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  resolvedCostUsd: number | null;
  createdAt: string;
};

export type CalibrationGroupRow = {
  key: string;
  label: string;
  rows: number;
  estimatedMinutes: number;
  estimatedHours: number;
  costUsd: number;
  usageRows: number;
  usageCostUsd: number;
  medianMinutes: number;
  p95Minutes: number;
  impliedUsdPerMinute: number | null;
};

export type CalibrationSuggestedRates = {
  conservativeUsdPerMinute: number;
  balancedUsdPerMinute: number;
  aggressiveUsdPerMinute: number;
  recommendation: string;
};

export type CalibrationQuality = {
  rowsMissingCost: number;
  rowsMissingWorkUnit: number;
  rowsMissingUsageEvent: number;
  zeroMinuteRows: number;
  usageRowsMissingWorkUnit: number;
  ledgerRowsWithoutUsageMatch: number;
  notes: string[];
};

export type CalibrationTotals = {
  ledgerRows: number;
  usageRows: number;
  estimatedWorkMinutes: number;
  estimatedWorkHours: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  usageResolvedCostUsd: number;
  impliedUsdPerWorkMinute: number | null;
};

export type WorkHoursCalibrationReport = {
  workspaceId: string;
  weekStart: string;
  monthStart: string;
  currentRateUsd: number;
  totals: CalibrationTotals;
  suggestedRates: CalibrationSuggestedRates;
  byWorkType: CalibrationGroupRow[];
  byCapability: CalibrationGroupRow[];
  byEmployee: CalibrationGroupRow[];
  byProvider: CalibrationGroupRow[];
  quality: CalibrationQuality;
  mode: typeof WORK_HOURS_SHADOW_MODE;
  softWarnings: WorkHoursSoftWarningsResult;
};

export type WorkHoursCalibrationWarningInput = Omit<
  WorkHoursCalibrationReport,
  "softWarnings"
>;

export type WorkHoursCalibrationParams = {
  workspaceId: string;
  weekStart?: string;
  monthStart?: string;
  client: SupabaseClient;
  employeeNames?: Record<string, string>;
};

type DbRow = Record<string, unknown>;

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundMinutes(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateImpliedUsdPerWorkMinute(
  costUsd: number,
  minutes: number,
): number | null {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return null;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return roundUsd(costUsd / minutes);
}

export function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return roundMinutes(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
  }
  return roundMinutes(sorted[mid] ?? 0);
}

export function resolveUsageEventCost(row: {
  actualCostUsd?: number | null;
  estimatedCostUsd?: number | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): number | null {
  return resolveShadowCostUsd({
    actualCostUsd: row.actualCostUsd,
    estimatedCostUsd: row.estimatedCostUsd,
    modelId: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  });
}

export function resolveLedgerRowCost(row: ShadowWorkMinutesLedgerRow): number | null {
  return resolveShadowCostUsd({
    actualCostUsd: row.actualCostUsd,
    estimatedCostUsd: row.estimatedCostUsd,
    modelId: row.modelId,
  });
}

export function suggestWorkMinuteUsdRate(params: {
  impliedUsdPerWorkMinute: number | null;
  currentRateUsd: number;
  groupRates: number[];
}): CalibrationSuggestedRates {
  const validGroupRates = params.groupRates.filter((rate) => rate > 0);
  const medianGroupRate =
    validGroupRates.length > 0 ? median(validGroupRates) : params.currentRateUsd;
  const implied = params.impliedUsdPerWorkMinute ?? medianGroupRate ?? params.currentRateUsd;

  const balancedUsdPerMinute = roundUsd(Math.max(0.001, implied || params.currentRateUsd));
  const conservativeUsdPerMinute = roundUsd(Math.max(0.001, balancedUsdPerMinute * 1.25));
  const aggressiveUsdPerMinute = roundUsd(Math.max(0.001, balancedUsdPerMinute * 0.8));

  let recommendation =
    "Collect more shadow ledger and usage data before changing AI_WORK_MINUTE_USD.";
  if (params.impliedUsdPerWorkMinute != null) {
    if (params.impliedUsdPerWorkMinute > params.currentRateUsd * 1.15) {
      recommendation =
        "Shadow minutes under-count cost versus usage. Consider raising AI_WORK_MINUTE_USD toward the balanced rate.";
    } else if (params.impliedUsdPerWorkMinute < params.currentRateUsd * 0.85) {
      recommendation =
        "Shadow minutes over-count cost versus usage. Consider lowering AI_WORK_MINUTE_USD toward the balanced rate.";
    } else {
      recommendation =
        "Current AI_WORK_MINUTE_USD is close to implied usage cost. Keep observing before soft warnings.";
    }
  }

  return {
    conservativeUsdPerMinute,
    balancedUsdPerMinute,
    aggressiveUsdPerMinute,
    recommendation,
  };
}

function ledgerRowFromDb(row: DbRow): ShadowWorkMinutesLedgerRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    employeeId: row.employee_id ? String(row.employee_id) : undefined,
    sourceType: String(row.source_type),
    sourceId: row.source_id ? String(row.source_id) : undefined,
    workUnitId: row.work_unit_id ? String(row.work_unit_id) : undefined,
    usageEventId: row.usage_event_id ? String(row.usage_event_id) : undefined,
    capability: row.capability ? String(row.capability) : undefined,
    workType: row.work_type ? String(row.work_type) : undefined,
    providerRoute: row.provider_route ? String(row.provider_route) : undefined,
    providerName: row.provider_name ? String(row.provider_name) : undefined,
    modelId: row.model_id ? String(row.model_id) : undefined,
    estimatedCostUsd:
      row.estimated_cost_usd != null ? Number(row.estimated_cost_usd) : undefined,
    actualCostUsd: row.actual_cost_usd != null ? Number(row.actual_cost_usd) : undefined,
    workMinutesEstimated: Number(row.work_minutes_estimated ?? 0),
    workMinutesCharged:
      row.work_minutes_charged != null ? Number(row.work_minutes_charged) : null,
    billingWeekStart: String(row.billing_week_start),
    billingMonthStart: String(row.billing_month_start),
    mode: WORK_HOURS_SHADOW_MODE,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}

function usageRowFromDb(row: DbRow): CalibrationUsageRow {
  const estimatedCostUsd = Number(row.estimated_cost_usd ?? 0);
  const actualCostUsd = row.actual_cost_usd != null ? Number(row.actual_cost_usd) : undefined;
  const inputTokens = Number(row.input_tokens ?? 0);
  const outputTokens = Number(row.output_tokens ?? 0);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    employeeId: row.employee_id ? String(row.employee_id) : undefined,
    provider: String(row.provider ?? "unknown"),
    model: String(row.model ?? "unknown"),
    capability: row.capability ? String(row.capability) : undefined,
    workUnitId: row.work_unit_id ? String(row.work_unit_id) : undefined,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    actualCostUsd,
    resolvedCostUsd: resolveUsageEventCost({
      actualCostUsd,
      estimatedCostUsd,
      model: String(row.model ?? ""),
      inputTokens,
      outputTokens,
    }),
    createdAt: String(row.created_at ?? ""),
  };
}

export function calculateCalibrationQuality(params: {
  ledgerRows: ShadowWorkMinutesLedgerRow[];
  usageRows: CalibrationUsageRow[];
  usageIdsWithLedger: Set<string>;
  workUnitIdsWithLedger: Set<string>;
}): CalibrationQuality {
  const notes: string[] = [];
  let rowsMissingCost = 0;
  let rowsMissingWorkUnit = 0;
  let rowsMissingUsageEvent = 0;
  let zeroMinuteRows = 0;

  for (const row of params.ledgerRows) {
    if (row.workMinutesEstimated <= 0) zeroMinuteRows += 1;
    if (!resolveLedgerRowCost(row)) rowsMissingCost += 1;
    if (!row.workUnitId) rowsMissingWorkUnit += 1;
    if (!row.usageEventId) rowsMissingUsageEvent += 1;
  }

  let usageRowsMissingWorkUnit = 0;
  for (const row of params.usageRows) {
    if (!row.workUnitId) usageRowsMissingWorkUnit += 1;
  }

  let ledgerRowsWithoutUsageMatch = 0;
  for (const row of params.ledgerRows) {
    const linked =
      (row.usageEventId && params.usageIdsWithLedger.has(row.usageEventId)) ||
      (row.workUnitId && params.workUnitIdsWithLedger.has(row.workUnitId));
    if (!linked) ledgerRowsWithoutUsageMatch += 1;
  }

  if (!params.ledgerRows.length) {
    notes.push("No shadow ledger rows for this week.");
  }
  if (!params.usageRows.length) {
    notes.push("No ai_usage_events rows for this week.");
  }
  if (rowsMissingUsageEvent > 0) {
    notes.push("Some ledger rows are not linked to usage_event_id yet.");
  }
  if (ledgerRowsWithoutUsageMatch > 0) {
    notes.push("Some ledger rows could not be matched to usage events by work unit or usage id.");
  }

  return {
    rowsMissingCost,
    rowsMissingWorkUnit,
    rowsMissingUsageEvent,
    zeroMinuteRows,
    usageRowsMissingWorkUnit,
    ledgerRowsWithoutUsageMatch,
    notes,
  };
}

export function calculateCalibrationSummary(params: {
  ledgerRows: ShadowWorkMinutesLedgerRow[];
  usageRows: CalibrationUsageRow[];
}): CalibrationTotals {
  const estimatedWorkMinutes = params.ledgerRows.reduce(
    (sum, row) => sum + row.workMinutesEstimated,
    0,
  );
  const estimatedCostUsd = params.ledgerRows.reduce(
    (sum, row) => sum + (resolveLedgerRowCost(row) ?? 0),
    0,
  );
  const actualCostUsd = params.ledgerRows.reduce(
    (sum, row) => sum + (row.actualCostUsd ?? 0),
    0,
  );
  const usageResolvedCostUsd = params.usageRows.reduce(
    (sum, row) => sum + (row.resolvedCostUsd ?? 0),
    0,
  );

  const costBasis =
    usageResolvedCostUsd > 0
      ? usageResolvedCostUsd
      : estimatedCostUsd > 0
        ? estimatedCostUsd
        : actualCostUsd;

  return {
    ledgerRows: params.ledgerRows.length,
    usageRows: params.usageRows.length,
    estimatedWorkMinutes: roundMinutes(estimatedWorkMinutes),
    estimatedWorkHours: roundMinutes(estimatedWorkMinutes / 60),
    estimatedCostUsd: roundUsd(estimatedCostUsd),
    actualCostUsd: roundUsd(actualCostUsd),
    usageResolvedCostUsd: roundUsd(usageResolvedCostUsd),
    impliedUsdPerWorkMinute: calculateImpliedUsdPerWorkMinute(
      costBasis,
      estimatedWorkMinutes,
    ),
  };
}

type GroupKey = {
  key: string;
  label: string;
};

function groupKeyForLedger(row: ShadowWorkMinutesLedgerRow, dimension: "workType" | "capability" | "employee" | "provider"): GroupKey {
  switch (dimension) {
    case "workType": {
      const key = row.workType ?? row.sourceType ?? "unknown";
      return { key, label: formatWorkTypeLabel(key) };
    }
    case "capability": {
      const key = row.capability ?? "unknown";
      return { key, label: formatCapabilityLabel(key) };
    }
    case "employee": {
      const key = row.employeeId ?? "unknown";
      return { key, label: row.employeeId ?? "Unknown employee" };
    }
    case "provider": {
      const key = row.providerName ?? row.providerRoute ?? "unknown";
      return { key, label: key };
    }
  }
}

function groupKeyForUsage(row: CalibrationUsageRow, dimension: "workType" | "capability" | "employee" | "provider"): GroupKey | null {
  switch (dimension) {
    case "workType":
      return null;
    case "capability": {
      const key = row.capability ?? "unknown";
      return { key, label: formatCapabilityLabel(key) };
    }
    case "employee": {
      const key = row.employeeId ?? "unknown";
      return { key, label: row.employeeId ?? "Unknown employee" };
    }
    case "provider": {
      const key = row.provider ?? "unknown";
      return { key, label: key };
    }
  }
}

export function groupCalibrationRows(params: {
  ledgerRows: ShadowWorkMinutesLedgerRow[];
  usageRows: CalibrationUsageRow[];
  dimension: "workType" | "capability" | "employee" | "provider";
}): CalibrationGroupRow[] {
  const groups = new Map<
    string,
    {
      label: string;
      minutes: number[];
      costUsd: number;
      usageRows: number;
      usageCostUsd: number;
    }
  >();

  for (const row of params.ledgerRows) {
    const { key, label } = groupKeyForLedger(row, params.dimension);
    const bucket = groups.get(key) ?? {
      label,
      minutes: [],
      costUsd: 0,
      usageRows: 0,
      usageCostUsd: 0,
    };
    bucket.minutes.push(row.workMinutesEstimated);
    bucket.costUsd += resolveLedgerRowCost(row) ?? 0;
    groups.set(key, bucket);
  }

  for (const row of params.usageRows) {
    const group = groupKeyForUsage(row, params.dimension);
    if (!group) continue;
    const bucket = groups.get(group.key) ?? {
      label: group.label,
      minutes: [],
      costUsd: 0,
      usageRows: 0,
      usageCostUsd: 0,
    };
    bucket.usageRows += 1;
    bucket.usageCostUsd += row.resolvedCostUsd ?? 0;
    groups.set(group.key, bucket);
  }

  return [...groups.entries()]
    .map(([key, bucket]) => {
      const estimatedMinutes = roundMinutes(bucket.minutes.reduce((sum, v) => sum + v, 0));
      const costUsd = roundUsd(bucket.costUsd);
      const usageCostUsd = roundUsd(bucket.usageCostUsd);
      const costBasis = usageCostUsd > 0 ? usageCostUsd : costUsd;
      return {
        key,
        label: bucket.label,
        rows: bucket.minutes.length,
        estimatedMinutes,
        estimatedHours: roundMinutes(estimatedMinutes / 60),
        costUsd,
        usageRows: bucket.usageRows,
        usageCostUsd,
        medianMinutes: median(bucket.minutes),
        p95Minutes: roundMinutes(percentile(bucket.minutes, 95)),
        impliedUsdPerMinute: calculateImpliedUsdPerWorkMinute(costBasis, estimatedMinutes),
      };
    })
    .sort((a, b) => b.estimatedMinutes - a.estimatedMinutes);
}

async function fetchLedgerRows(
  client: SupabaseClient,
  workspaceId: string,
  weekStart: string,
): Promise<ShadowWorkMinutesLedgerRow[]> {
  const { data, error } = await client
    .from("ai_work_minutes_ledger")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("billing_week_start", weekStart)
    .eq("mode", WORK_HOURS_SHADOW_MODE);

  if (error) throw error;
  return ((data as DbRow[] | null) ?? []).map(ledgerRowFromDb);
}

async function fetchUsageRows(
  client: SupabaseClient,
  workspaceId: string,
  weekStart: string,
): Promise<CalibrationUsageRow[]> {
  const { startIso, endExclusiveIso } = getBillingWeekRangeIso(weekStart);
  const { data, error } = await client
    .from("ai_usage_events")
    .select(
      "id, workspace_id, employee_id, provider, model, capability, work_unit_id, input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, created_at",
    )
    .eq("workspace_id", workspaceId)
    .gte("created_at", startIso)
    .lt("created_at", endExclusiveIso);

  if (error) throw error;
  return ((data as DbRow[] | null) ?? []).map(usageRowFromDb);
}

export async function getWorkHoursCalibrationReport(
  params: WorkHoursCalibrationParams,
): Promise<WorkHoursCalibrationReport> {
  const weekStart = params.weekStart ?? getBillingWeekStart(new Date());
  const monthStart = params.monthStart ?? getBillingMonthStart(parseWeekStartDate(weekStart));
  const currentRateUsd = getWorkMinuteUsdRate();

  const [ledgerRows, usageRows] = await Promise.all([
    fetchLedgerRows(params.client, params.workspaceId, weekStart),
    fetchUsageRows(params.client, params.workspaceId, weekStart),
  ]);

  const usageIdsWithLedger = new Set(
    ledgerRows.map((row) => row.usageEventId).filter(Boolean) as string[],
  );
  const workUnitIdsWithUsage = new Set(
    usageRows.map((row) => row.workUnitId).filter(Boolean) as string[],
  );

  const totals = calculateCalibrationSummary({ ledgerRows, usageRows });
  const byWorkType = groupCalibrationRows({
    ledgerRows,
    usageRows,
    dimension: "workType",
  });
  const groupRates = byWorkType
    .map((row) => row.impliedUsdPerMinute)
    .filter((rate): rate is number => rate != null && rate > 0);

  const suggestedRates = suggestWorkMinuteUsdRate({
    impliedUsdPerWorkMinute: totals.impliedUsdPerWorkMinute,
    currentRateUsd,
    groupRates,
  });

  const quality = calculateCalibrationQuality({
    ledgerRows,
    usageRows,
    usageIdsWithLedger,
    workUnitIdsWithLedger: workUnitIdsWithUsage,
  });

  const reportWithoutWarnings: WorkHoursCalibrationWarningInput = {
    workspaceId: params.workspaceId,
    weekStart,
    monthStart,
    currentRateUsd,
    totals,
    suggestedRates,
    byWorkType,
    byCapability: groupCalibrationRows({ ledgerRows, usageRows, dimension: "capability" }),
    byEmployee: groupCalibrationRows({ ledgerRows, usageRows, dimension: "employee" }),
    byProvider: groupCalibrationRows({ ledgerRows, usageRows, dimension: "provider" }),
    quality,
    mode: WORK_HOURS_SHADOW_MODE,
  };

  return {
    ...reportWithoutWarnings,
    softWarnings: evaluateWorkHoursSoftWarnings(reportWithoutWarnings, {
      employeeNames: params.employeeNames,
    }),
  };
}

function parseWeekStartDate(weekStart: string): Date {
  const [year, month, day] = weekStart.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

export const CALIBRATION_UI_BADGE = "Internal calibration — not billing";

export const CALIBRATION_UI_COPY = [
  CALIBRATION_UI_BADGE,
  "Compare shadow Work Minutes against usage cost to tune AI_WORK_MINUTE_USD.",
  "Current rate",
  "Implied USD / Work Minute",
  "Suggested balanced rate",
  "Data quality",
  "By work type",
];

export function assertNoForbiddenCalibrationCopy(text: string): boolean {
  return assertNoForbiddenWorkHoursCopy(text);
}
