import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiWorkUnit } from "@/lib/supabase/ai-work-units";
import { estimateWorkMinutesFromCost } from "./estimate";
import { summarizeWorkspaceWorkMinutes } from "./ledger";
import { getBillingWeekRangeIso, getBillingWeekStart } from "./periods";
import { assertNoForbiddenWorkHoursCopy } from "./warnings";

export const SOFT_CAP_SIMULATION_BADGE = "Internal simulation — no enforcement";

export const SOFT_CAP_SIMULATION_HELPER =
  "AdeHQ is simulating how weekly Work Hour soft caps would behave. These estimates do not block usage and are not used for billing.";

export const SOFT_CAP_SIMULATION_UI_COPY = [
  SOFT_CAP_SIMULATION_BADGE,
  SOFT_CAP_SIMULATION_HELPER,
  "Soft-cap simulation",
  "Simulated cap progress",
  "Would have warned",
  "Would have exceeded internal soft cap",
  "Internal workspace soft cap",
  "Current shadow usage",
] as const;

export type SoftCapSimulationAction = "allow" | "warn_only" | "would_have_capped";

export type SoftCapSimulationConfig = {
  simulationEnabled: boolean;
  preRunEstimatesEnabled: boolean;
  defaultWeeklySoftCapMinutes: number;
  defaultEmployeeSoftCapMinutes: number;
  warnThresholdRatio: number;
};

export type PreRunEstimateParams = {
  workType: string;
  capability?: string;
  estimatedCostUsd?: number | null;
  estimatedWorkMinutes?: number | null;
  runtimeMode?: string;
  providerRoute?: string;
  modelId?: string;
};

export type SoftCapSimulationCurrent = {
  usedMinutes: number;
  usedHours: number;
  estimatedNextRunMinutes: number;
  projectedMinutesAfterRun: number;
};

export type WorkspaceSoftCapSimulation = {
  softCapMinutes: number;
  wouldExceedSoftCap: boolean;
  percentOfSoftCap: number;
};

export type EmployeeSoftCapSimulation = {
  employeeId: string;
  usedMinutes: number;
  softCapMinutes: number;
  wouldExceedSoftCap: boolean;
  percentOfSoftCap: number;
};

export type SoftCapSimulationResult = {
  enabled: boolean;
  workspaceId: string;
  weekStart: string;
  current: SoftCapSimulationCurrent;
  workspaceSimulation: WorkspaceSoftCapSimulation;
  employeeSimulation?: EmployeeSoftCapSimulation;
  action: SoftCapSimulationAction;
  shadowOnly: true;
  message: string;
};

export type SoftCapSimulationEventRow = {
  id: string;
  workspaceId: string;
  employeeId?: string;
  eventType: string;
  sourceType: string;
  sourceId?: string;
  workType?: string;
  capability?: string;
  usedMinutesBefore: number;
  estimatedNextMinutes: number;
  projectedMinutesAfter: number;
  workspaceSoftCapMinutes?: number;
  employeeSoftCapMinutes?: number;
  wouldExceedWorkspaceSoftCap: boolean;
  wouldExceedEmployeeSoftCap: boolean;
  action: SoftCapSimulationAction;
  shadowOnly: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SoftCapSimulationSummary = {
  workspaceId: string;
  weekStart: string;
  shadowOnly: true;
  enabled: boolean;
  workspaceSoftCapMinutes: number;
  employeeSoftCapMinutes: number;
  usedMinutes: number;
  usedHours: number;
  simulatedCapProgressPct: number;
  projectedEvents: Array<{
    action: SoftCapSimulationAction;
    count: number;
  }>;
  recentSimulationEvents: SoftCapSimulationEventRow[];
  byEmployee: Array<{
    employeeId: string;
    usedMinutes: number;
    simulatedCapProgressPct: number;
    eventCount: number;
  }>;
  byWorkType: Array<{
    workType: string;
    usedMinutes: number;
    eventCount: number;
  }>;
};

const PRE_RUN_DEFAULT_MINUTES: Record<string, number> = {
  employee_direct_response: 1,
  employee_queued_response: 1,
  topic_summary: 2,
  orchestration_classify: 0.25,
  hiring_recruiter: 1,
  hiring_candidates: 3,
  file_embedding: 5,
  browser_research: 15,
  browser_research_future_placeholder: 15,
};

const PRIORITIZED_SIMULATION_WORK_TYPES = new Set([
  "employee_direct_response",
  "employee_queued_response",
  "file_embedding",
  "hiring_candidates",
  "topic_summary",
  "hiring_recruiter",
]);

const SKIPPED_SIMULATION_WORK_TYPES = new Set(["orchestration_classify"]);

type DbRow = Record<string, unknown>;

function readBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultValue;
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return true;
}

function readNumberEnv(name: string, defaultValue: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : defaultValue;
}

function roundMinutes(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPct(value: number): number {
  return Math.round(value * 1000) / 10;
}

function percentOf(capMinutes: number, totalMinutes: number): number {
  if (capMinutes <= 0) return 0;
  return roundPct(totalMinutes / capMinutes);
}

export function getSoftCapSimulationConfig(): SoftCapSimulationConfig {
  return {
    simulationEnabled: readBoolEnv("AI_WORK_HOURS_SOFT_CAP_SIMULATION_ENABLED", true),
    preRunEstimatesEnabled: readBoolEnv("AI_WORK_HOURS_PRE_RUN_ESTIMATES_ENABLED", true),
    defaultWeeklySoftCapMinutes: readNumberEnv(
      "AI_WORK_HOURS_DEFAULT_WEEKLY_SOFT_CAP_MINUTES",
      600,
    ),
    defaultEmployeeSoftCapMinutes: readNumberEnv(
      "AI_WORK_HOURS_DEFAULT_EMPLOYEE_SOFT_CAP_MINUTES",
      240,
    ),
    warnThresholdRatio: 0.85,
  };
}

export function shouldSimulateWorkType(workType: string): boolean {
  if (SKIPPED_SIMULATION_WORK_TYPES.has(workType)) return false;
  return PRIORITIZED_SIMULATION_WORK_TYPES.has(workType);
}

export function estimatePreRunWorkMinutes(
  params: PreRunEstimateParams,
  config: SoftCapSimulationConfig = getSoftCapSimulationConfig(),
): number {
  if (!config.preRunEstimatesEnabled) return 0;

  if (params.estimatedWorkMinutes != null && params.estimatedWorkMinutes > 0) {
    return roundMinutes(params.estimatedWorkMinutes);
  }

  if (params.estimatedCostUsd != null && params.estimatedCostUsd > 0) {
    const fromCost = estimateWorkMinutesFromCost(params.estimatedCostUsd);
    if (fromCost > 0) return roundMinutes(fromCost);
  }

  const fallback = PRE_RUN_DEFAULT_MINUTES[params.workType];
  if (fallback != null) return roundMinutes(fallback);

  return 0;
}

export function evaluateWorkspaceSoftCapSimulation(params: {
  usedMinutes: number;
  estimatedNextRunMinutes: number;
  softCapMinutes: number;
  warnThresholdRatio?: number;
}): WorkspaceSoftCapSimulation & { projectedMinutesAfterRun: number; action: SoftCapSimulationAction } {
  const projectedMinutesAfterRun = roundMinutes(
    params.usedMinutes + params.estimatedNextRunMinutes,
  );
  const wouldExceedSoftCap = projectedMinutesAfterRun > params.softCapMinutes;
  const percentOfSoftCap = percentOf(params.softCapMinutes, projectedMinutesAfterRun);
  const warnThreshold = params.warnThresholdRatio ?? 0.85;

  let action: SoftCapSimulationAction = "allow";
  if (wouldExceedSoftCap) {
    action = "would_have_capped";
  } else if (percentOfSoftCap / 100 >= warnThreshold) {
    action = "warn_only";
  }

  return {
    softCapMinutes: params.softCapMinutes,
    wouldExceedSoftCap,
    percentOfSoftCap,
    projectedMinutesAfterRun,
    action,
  };
}

export function evaluateEmployeeSoftCapSimulation(params: {
  employeeId: string;
  usedMinutes: number;
  estimatedNextRunMinutes: number;
  softCapMinutes: number;
  warnThresholdRatio?: number;
}): EmployeeSoftCapSimulation & { projectedMinutesAfterRun: number; action: SoftCapSimulationAction } {
  const projectedMinutesAfterRun = roundMinutes(
    params.usedMinutes + params.estimatedNextRunMinutes,
  );
  const wouldExceedSoftCap = projectedMinutesAfterRun > params.softCapMinutes;
  const percentOfSoftCap = percentOf(params.softCapMinutes, projectedMinutesAfterRun);
  const warnThreshold = params.warnThresholdRatio ?? 0.85;

  let action: SoftCapSimulationAction = "allow";
  if (wouldExceedSoftCap) {
    action = "would_have_capped";
  } else if (percentOfSoftCap / 100 >= warnThreshold) {
    action = "warn_only";
  }

  return {
    employeeId: params.employeeId,
    usedMinutes: roundMinutes(params.usedMinutes),
    softCapMinutes: params.softCapMinutes,
    wouldExceedSoftCap,
    percentOfSoftCap,
    projectedMinutesAfterRun,
    action,
  };
}

function mergeActions(
  workspaceAction: SoftCapSimulationAction,
  employeeAction?: SoftCapSimulationAction,
): SoftCapSimulationAction {
  const rank: Record<SoftCapSimulationAction, number> = {
    allow: 0,
    warn_only: 1,
    would_have_capped: 2,
  };
  const employee = employeeAction ?? "allow";
  return rank[workspaceAction] >= rank[employee] ? workspaceAction : employee;
}

function buildSimulationMessage(params: {
  action: SoftCapSimulationAction;
  workspaceSimulation: WorkspaceSoftCapSimulation;
  employeeSimulation?: EmployeeSoftCapSimulation;
}): string {
  if (params.action === "would_have_capped") {
    if (params.employeeSimulation?.wouldExceedSoftCap) {
      return "Shadow estimate would have exceeded internal employee soft cap — simulation only, not enforced.";
    }
    return "Shadow estimate would have exceeded internal workspace soft cap — simulation only, not enforced.";
  }
  if (params.action === "warn_only") {
    return `Shadow estimate would have warned at ${params.workspaceSimulation.percentOfSoftCap}% simulated cap progress — not enforced.`;
  }
  return "Shadow estimate would stay within internal soft cap simulation.";
}

export function evaluateSoftCapSimulation(params: {
  workspaceId: string;
  weekStart: string;
  usedMinutes: number;
  estimatedNextRunMinutes: number;
  employeeId?: string;
  employeeUsedMinutes?: number;
  config?: SoftCapSimulationConfig;
}): SoftCapSimulationResult {
  const config = params.config ?? getSoftCapSimulationConfig();
  const enabled = config.simulationEnabled && config.preRunEstimatesEnabled;
  const usedMinutes = roundMinutes(params.usedMinutes);
  const estimatedNextRunMinutes = roundMinutes(params.estimatedNextRunMinutes);

  const workspaceEval = evaluateWorkspaceSoftCapSimulation({
    usedMinutes,
    estimatedNextRunMinutes,
    softCapMinutes: config.defaultWeeklySoftCapMinutes,
    warnThresholdRatio: config.warnThresholdRatio,
  });

  let employeeSimulation: EmployeeSoftCapSimulation | undefined;
  let employeeAction: SoftCapSimulationAction | undefined;

  if (params.employeeId) {
    const employeeEval = evaluateEmployeeSoftCapSimulation({
      employeeId: params.employeeId,
      usedMinutes: params.employeeUsedMinutes ?? 0,
      estimatedNextRunMinutes,
      softCapMinutes: config.defaultEmployeeSoftCapMinutes,
      warnThresholdRatio: config.warnThresholdRatio,
    });
    employeeSimulation = {
      employeeId: employeeEval.employeeId,
      usedMinutes: employeeEval.usedMinutes,
      softCapMinutes: employeeEval.softCapMinutes,
      wouldExceedSoftCap: employeeEval.wouldExceedSoftCap,
      percentOfSoftCap: employeeEval.percentOfSoftCap,
    };
    employeeAction = employeeEval.action;
  }

  const action = enabled
    ? mergeActions(workspaceEval.action, employeeAction)
    : "allow";

  return {
    enabled,
    workspaceId: params.workspaceId,
    weekStart: params.weekStart,
    current: {
      usedMinutes,
      usedHours: roundMinutes(usedMinutes / 60),
      estimatedNextRunMinutes,
      projectedMinutesAfterRun: workspaceEval.projectedMinutesAfterRun,
    },
    workspaceSimulation: {
      softCapMinutes: workspaceEval.softCapMinutes,
      wouldExceedSoftCap: workspaceEval.wouldExceedSoftCap,
      percentOfSoftCap: workspaceEval.percentOfSoftCap,
    },
    employeeSimulation,
    action,
    shadowOnly: true,
    message: buildSimulationMessage({
      action,
      workspaceSimulation: {
        softCapMinutes: workspaceEval.softCapMinutes,
        wouldExceedSoftCap: workspaceEval.wouldExceedSoftCap,
        percentOfSoftCap: workspaceEval.percentOfSoftCap,
      },
      employeeSimulation,
    }),
  };
}

function isMissingSimulationTableError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: string }).message)
        : String(error ?? "");
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  return (
    code === "42P01" ||
    (msg.includes("ai_work_hours_simulation_events") && msg.includes("does not exist")) ||
    msg.includes("Could not find the table")
  );
}

function eventFromDb(row: DbRow): SoftCapSimulationEventRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    employeeId: row.employee_id ? String(row.employee_id) : undefined,
    eventType: String(row.event_type),
    sourceType: String(row.source_type),
    sourceId: row.source_id ? String(row.source_id) : undefined,
    workType: row.work_type ? String(row.work_type) : undefined,
    capability: row.capability ? String(row.capability) : undefined,
    usedMinutesBefore: Number(row.used_minutes_before ?? 0),
    estimatedNextMinutes: Number(row.estimated_next_minutes ?? 0),
    projectedMinutesAfter: Number(row.projected_minutes_after ?? 0),
    workspaceSoftCapMinutes:
      row.workspace_soft_cap_minutes != null
        ? Number(row.workspace_soft_cap_minutes)
        : undefined,
    employeeSoftCapMinutes:
      row.employee_soft_cap_minutes != null
        ? Number(row.employee_soft_cap_minutes)
        : undefined,
    wouldExceedWorkspaceSoftCap: Boolean(row.would_exceed_workspace_soft_cap),
    wouldExceedEmployeeSoftCap: Boolean(row.would_exceed_employee_soft_cap),
    action: String(row.action) as SoftCapSimulationAction,
    shadowOnly: Boolean(row.shadow_only ?? true),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}

export async function recordSoftCapSimulationEvent(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId?: string;
    eventType: string;
    sourceType: string;
    sourceId?: string;
    workType?: string;
    capability?: string;
    result: SoftCapSimulationResult;
    metadata?: Record<string, unknown>;
  },
): Promise<SoftCapSimulationEventRow | null> {
  const config = getSoftCapSimulationConfig();
  if (!config.simulationEnabled || !params.result.enabled) return null;

  const payload = {
    workspace_id: params.workspaceId,
    employee_id: params.employeeId ?? null,
    event_type: params.eventType,
    source_type: params.sourceType,
    source_id: params.sourceId ?? null,
    work_type: params.workType ?? null,
    capability: params.capability ?? null,
    used_minutes_before: params.result.current.usedMinutes,
    estimated_next_minutes: params.result.current.estimatedNextRunMinutes,
    projected_minutes_after: params.result.current.projectedMinutesAfterRun,
    workspace_soft_cap_minutes: params.result.workspaceSimulation.softCapMinutes,
    employee_soft_cap_minutes: params.result.employeeSimulation?.softCapMinutes ?? null,
    would_exceed_workspace_soft_cap: params.result.workspaceSimulation.wouldExceedSoftCap,
    would_exceed_employee_soft_cap: params.result.employeeSimulation?.wouldExceedSoftCap ?? false,
    action: params.result.action,
    shadow_only: true,
    metadata: {
      message: params.result.message,
      weekStart: params.result.weekStart,
      ...(params.metadata ?? {}),
    },
  };

  const { data, error } = await client
    .from("ai_work_hours_simulation_events")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (isMissingSimulationTableError(error)) {
      console.warn(
        "[AdeHQ soft-cap simulation] ai_work_hours_simulation_events table missing — apply migration 20260705140000_work_hours_soft_cap_simulation.sql",
      );
      return null;
    }
    throw error;
  }

  return eventFromDb(data as DbRow);
}

export async function maybeRunSoftCapSimulationForWorkUnit(
  client: SupabaseClient,
  workUnit: AiWorkUnit,
): Promise<SoftCapSimulationResult | null> {
  const config = getSoftCapSimulationConfig();
  if (!config.simulationEnabled || !config.preRunEstimatesEnabled) {
    return null;
  }
  if (!workUnit.workspaceId?.trim()) return null;
  if (!shouldSimulateWorkType(workUnit.workType)) return null;

  const estimatedNextRunMinutes = estimatePreRunWorkMinutes({
    workType: workUnit.workType,
    capability: workUnit.capability,
    estimatedCostUsd: workUnit.estimatedCostUsd,
    estimatedWorkMinutes: workUnit.estimatedWorkMinutes,
    runtimeMode: workUnit.runtimeMode,
    providerRoute: workUnit.providerRoute,
    modelId: workUnit.modelId,
  });

  if (estimatedNextRunMinutes <= 0) return null;

  const weekStart = getBillingWeekStart(new Date());
  const summary = await summarizeWorkspaceWorkMinutes(client, workUnit.workspaceId, { weekStart });
  const employeeUsedMinutes = workUnit.employeeId
    ? summary.byEmployee.find((row) => row.employeeId === workUnit.employeeId)?.minutes ?? 0
    : 0;

  const result = evaluateSoftCapSimulation({
    workspaceId: workUnit.workspaceId,
    weekStart,
    usedMinutes: summary.totalEstimatedMinutes,
    estimatedNextRunMinutes,
    employeeId: workUnit.employeeId,
    employeeUsedMinutes,
    config,
  });

  if (result.action === "allow") {
    return result;
  }

  await recordSoftCapSimulationEvent(client, {
    workspaceId: workUnit.workspaceId,
    employeeId: workUnit.employeeId,
    eventType: "pre_run_soft_cap_simulation",
    sourceType: workUnit.workType,
    sourceId: workUnit.id,
    workType: workUnit.workType,
    capability: workUnit.capability,
    result,
    metadata: {
      workUnitId: workUnit.id,
      providerRoute: workUnit.providerRoute,
      modelId: workUnit.modelId,
    },
  }).catch((error) => {
    console.warn("[AdeHQ soft-cap simulation]", error);
  });

  return result;
}

export async function getSoftCapSimulationSummary(
  client: SupabaseClient,
  workspaceId: string,
  weekStart?: string,
): Promise<SoftCapSimulationSummary> {
  const config = getSoftCapSimulationConfig();
  const resolvedWeekStart = weekStart ?? getBillingWeekStart(new Date());
  const { startIso, endExclusiveIso } = getBillingWeekRangeIso(resolvedWeekStart);

  const shadowSummary = await summarizeWorkspaceWorkMinutes(client, workspaceId, {
    weekStart: resolvedWeekStart,
  });

  let events: SoftCapSimulationEventRow[] = [];
  const { data, error } = await client
    .from("ai_work_hours_simulation_events")
    .select("*")
    .eq("workspace_id", workspaceId)
    .gte("created_at", startIso)
    .lt("created_at", endExclusiveIso)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    if (!isMissingSimulationTableError(error)) throw error;
  } else {
    events = ((data as DbRow[] | null) ?? []).map(eventFromDb);
  }

  const projectedEventsMap = new Map<SoftCapSimulationAction, number>();
  const byEmployeeMap = new Map<string, { usedMinutes: number; eventCount: number }>();
  const byWorkTypeMap = new Map<string, { usedMinutes: number; eventCount: number }>();

  for (const event of events) {
    projectedEventsMap.set(event.action, (projectedEventsMap.get(event.action) ?? 0) + 1);
    if (event.employeeId) {
      const existing = byEmployeeMap.get(event.employeeId) ?? { usedMinutes: 0, eventCount: 0 };
      byEmployeeMap.set(event.employeeId, {
        usedMinutes: existing.usedMinutes,
        eventCount: existing.eventCount + 1,
      });
    }
    const workType = event.workType ?? event.sourceType;
    const workTypeExisting = byWorkTypeMap.get(workType) ?? { usedMinutes: 0, eventCount: 0 };
    byWorkTypeMap.set(workType, {
      usedMinutes: workTypeExisting.usedMinutes,
      eventCount: workTypeExisting.eventCount + 1,
    });
  }

  for (const row of shadowSummary.byEmployee) {
    const existing = byEmployeeMap.get(row.employeeId) ?? { usedMinutes: 0, eventCount: 0 };
    byEmployeeMap.set(row.employeeId, {
      usedMinutes: row.minutes,
      eventCount: existing.eventCount,
    });
  }

  for (const row of shadowSummary.byWorkType) {
    const existing = byWorkTypeMap.get(row.workType) ?? { usedMinutes: 0, eventCount: 0 };
    byWorkTypeMap.set(row.workType, {
      usedMinutes: row.minutes,
      eventCount: existing.eventCount,
    });
  }

  const usedMinutes = shadowSummary.totalEstimatedMinutes;
  const simulatedCapProgressPct = percentOf(config.defaultWeeklySoftCapMinutes, usedMinutes);

  return {
    workspaceId,
    weekStart: resolvedWeekStart,
    shadowOnly: true,
    enabled: config.simulationEnabled && config.preRunEstimatesEnabled,
    workspaceSoftCapMinutes: config.defaultWeeklySoftCapMinutes,
    employeeSoftCapMinutes: config.defaultEmployeeSoftCapMinutes,
    usedMinutes,
    usedHours: shadowSummary.totalEstimatedHours,
    simulatedCapProgressPct,
    projectedEvents: [...projectedEventsMap.entries()].map(([action, count]) => ({
      action,
      count,
    })),
    recentSimulationEvents: events.slice(0, 10),
    byEmployee: [...byEmployeeMap.entries()]
      .map(([employeeId, row]) => ({
        employeeId,
        usedMinutes: row.usedMinutes,
        simulatedCapProgressPct: percentOf(config.defaultEmployeeSoftCapMinutes, row.usedMinutes),
        eventCount: row.eventCount,
      }))
      .sort((a, b) => b.usedMinutes - a.usedMinutes),
    byWorkType: [...byWorkTypeMap.entries()]
      .map(([workType, row]) => ({
        workType,
        usedMinutes: row.usedMinutes,
        eventCount: row.eventCount,
      }))
      .sort((a, b) => b.usedMinutes - a.usedMinutes),
  };
}

export function assertNoForbiddenSoftCapSimulationCopy(text: string): boolean {
  const lower = text.toLowerCase();
  const extraForbidden = ["hard limit enabled", "remaining hours", "hours remaining"];
  if (extraForbidden.some((phrase) => lower.includes(phrase))) return false;
  if (/\bremaining\b/.test(lower) && !lower.includes("for remaining scope")) return false;
  return assertNoForbiddenWorkHoursCopy(text);
}
