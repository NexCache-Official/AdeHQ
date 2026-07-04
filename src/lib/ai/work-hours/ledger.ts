import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiWorkUnit } from "@/lib/supabase/ai-work-units";
import { isWorkHoursShadowEnabled, WORK_HOURS_SHADOW_MODE } from "./constants";
import { estimateWorkMinutesFromCost, resolveShadowCostUsd } from "./estimate";
import { getBillingMonthStart, getBillingWeekStart } from "./periods";

export type ShadowWorkMinutesSourceType =
  | "topic_summary"
  | "orchestration_classify"
  | "hiring_recruiter"
  | "hiring_candidates"
  | "file_embedding"
  | "employee_direct_response_shadow"
  | "employee_queued_response_shadow"
  | "employee_direct_response"
  | "employee_queued_response"
  | (string & {});

export type RecordShadowWorkMinutesParams = {
  workspaceId: string;
  employeeId?: string | null;
  sourceType: ShadowWorkMinutesSourceType;
  sourceId?: string | null;
  workUnitId?: string | null;
  usageEventId?: string | null;
  capability?: string | null;
  workType?: string | null;
  providerRoute?: string | null;
  providerName?: string | null;
  modelId?: string | null;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  observedAt?: Date;
  metadata?: Record<string, unknown>;
};

export type ShadowWorkMinutesLedgerRow = {
  id: string;
  workspaceId: string;
  employeeId?: string;
  sourceType: string;
  sourceId?: string;
  workUnitId?: string;
  usageEventId?: string;
  capability?: string;
  workType?: string;
  providerRoute?: string;
  providerName?: string;
  modelId?: string;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  workMinutesEstimated: number;
  workMinutesCharged?: number | null;
  billingWeekStart: string;
  billingMonthStart: string;
  mode: typeof WORK_HOURS_SHADOW_MODE;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WorkMinutesSummaryRange = {
  weekStart?: string;
  weekEnd?: string;
};

export type WorkspaceWorkMinutesSummary = {
  workspaceId: string;
  weekStart: string;
  totalEstimatedMinutes: number;
  totalEstimatedHours: number;
  byEmployee: Array<{ employeeId: string; minutes: number }>;
  byCapability: Array<{ capability: string; minutes: number }>;
  byWorkType: Array<{ workType: string; minutes: number }>;
  mode: typeof WORK_HOURS_SHADOW_MODE;
};

type DbRow = Record<string, unknown>;

function isMissingLedgerTableError(error: unknown): boolean {
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
    (msg.includes("ai_work_minutes_ledger") && msg.includes("does not exist")) ||
    msg.includes("Could not find the table")
  );
}

function isDuplicateLedgerError(error: unknown): boolean {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  return code === "23505";
}

function rowFromDb(row: DbRow): ShadowWorkMinutesLedgerRow {
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

export function buildShadowWorkMinutesInsertPayload(
  params: RecordShadowWorkMinutesParams,
): Record<string, unknown> | null {
  const costUsd = resolveShadowCostUsd({
    actualCostUsd: params.actualCostUsd,
    estimatedCostUsd: params.estimatedCostUsd,
    modelId: params.modelId,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
  });
  if (costUsd == null || costUsd <= 0) return null;

  const workMinutesEstimated = estimateWorkMinutesFromCost(costUsd);
  if (workMinutesEstimated <= 0) return null;

  const observedAt = params.observedAt ?? new Date();
  const deduped = Boolean(params.workUnitId || params.usageEventId);

  return {
    workspace_id: params.workspaceId,
    employee_id: params.employeeId ?? null,
    source_type: params.sourceType,
    source_id: params.sourceId ?? null,
    work_unit_id: params.workUnitId ?? null,
    usage_event_id: params.usageEventId ?? null,
    capability: params.capability ?? null,
    work_type: params.workType ?? params.sourceType,
    provider_route: params.providerRoute ?? null,
    provider_name: params.providerName ?? null,
    model_id: params.modelId ?? null,
    estimated_cost_usd: params.estimatedCostUsd ?? null,
    actual_cost_usd: params.actualCostUsd ?? costUsd,
    work_minutes_estimated: workMinutesEstimated,
    work_minutes_charged: null,
    billing_week_start: getBillingWeekStart(observedAt),
    billing_month_start: getBillingMonthStart(observedAt),
    mode: WORK_HOURS_SHADOW_MODE,
    metadata: {
      deduped,
      ...(params.metadata ?? {}),
    },
  };
}

async function findExistingShadowLedgerRow(
  client: SupabaseClient,
  params: Pick<RecordShadowWorkMinutesParams, "workUnitId" | "usageEventId" | "sourceType">,
): Promise<ShadowWorkMinutesLedgerRow | null> {
  if (params.workUnitId) {
    const { data, error } = await client
      .from("ai_work_minutes_ledger")
      .select("*")
      .eq("work_unit_id", params.workUnitId)
      .eq("source_type", params.sourceType)
      .maybeSingle();
    if (error && !isMissingLedgerTableError(error)) throw error;
    return data ? rowFromDb(data as DbRow) : null;
  }

  if (params.usageEventId) {
    const { data, error } = await client
      .from("ai_work_minutes_ledger")
      .select("*")
      .eq("usage_event_id", params.usageEventId)
      .eq("source_type", params.sourceType)
      .maybeSingle();
    if (error && !isMissingLedgerTableError(error)) throw error;
    return data ? rowFromDb(data as DbRow) : null;
  }

  return null;
}

/** Insert a shadow Work Minutes ledger row (measurement only — never charges). */
export async function recordShadowWorkMinutes(
  client: SupabaseClient,
  params: RecordShadowWorkMinutesParams,
): Promise<ShadowWorkMinutesLedgerRow | null> {
  if (!isWorkHoursShadowEnabled()) return null;

  const payload = buildShadowWorkMinutesInsertPayload(params);
  if (!payload) return null;

  const existing = await findExistingShadowLedgerRow(client, params);
  if (existing) return existing;

  const { data, error } = await client
    .from("ai_work_minutes_ledger")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (isMissingLedgerTableError(error)) {
      throw new Error(
        "ai_work_minutes_ledger table is not available. Apply migration 20260705130000_work_hours_shadow_metering.sql.",
      );
    }
    if (isDuplicateLedgerError(error)) {
      return findExistingShadowLedgerRow(client, params);
    }
    throw error;
  }

  return rowFromDb(data as DbRow);
}

export async function recordShadowWorkMinutesFromWorkUnit(
  client: SupabaseClient,
  workUnit: AiWorkUnit,
  params?: {
    actualCostUsd?: number | null;
    estimatedCostUsd?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    usageEventId?: string | null;
    sourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<ShadowWorkMinutesLedgerRow | null> {
  const metadata = (params?.metadata ?? workUnit.metadata) as Record<string, unknown>;
  const inputTokens =
    params?.inputTokens ??
    (typeof metadata.inputTokens === "number" ? metadata.inputTokens : undefined);
  const outputTokens =
    params?.outputTokens ??
    (typeof metadata.outputTokens === "number" ? metadata.outputTokens : undefined);

  return recordShadowWorkMinutes(client, {
    workspaceId: workUnit.workspaceId,
    employeeId: workUnit.employeeId,
    sourceType: workUnit.workType,
    sourceId: params?.sourceId ?? workUnit.topicId ?? workUnit.roomId ?? workUnit.id,
    workUnitId: workUnit.id,
    usageEventId: params?.usageEventId ?? undefined,
    capability: workUnit.capability,
    workType: workUnit.workType,
    providerRoute: workUnit.providerRoute,
    providerName: workUnit.providerName,
    modelId: workUnit.modelId,
    estimatedCostUsd: params?.estimatedCostUsd ?? workUnit.estimatedCostUsd,
    actualCostUsd: params?.actualCostUsd ?? workUnit.actualCostUsd,
    inputTokens,
    outputTokens,
    metadata: {
      workUnitStatus: workUnit.status,
      ...(params?.metadata ?? {}),
    },
  });
}

export async function summarizeWorkspaceWorkMinutes(
  client: SupabaseClient,
  workspaceId: string,
  range: WorkMinutesSummaryRange = {},
): Promise<WorkspaceWorkMinutesSummary> {
  const weekStart = range.weekStart ?? getBillingWeekStart(new Date());

  let query = client
    .from("ai_work_minutes_ledger")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("billing_week_start", weekStart)
    .eq("mode", WORK_HOURS_SHADOW_MODE);

  if (range.weekEnd) {
    query = query.lte("billing_week_start", range.weekEnd);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingLedgerTableError(error)) {
      throw new Error(
        "ai_work_minutes_ledger table is not available. Apply migration 20260705130000_work_hours_shadow_metering.sql.",
      );
    }
    throw error;
  }

  const rows = ((data as DbRow[] | null) ?? []).map(rowFromDb);
  const totalEstimatedMinutes = rows.reduce((sum, row) => sum + row.workMinutesEstimated, 0);

  const byEmployeeMap = new Map<string, number>();
  const byCapabilityMap = new Map<string, number>();
  const byWorkTypeMap = new Map<string, number>();

  for (const row of rows) {
    if (row.employeeId) {
      byEmployeeMap.set(
        row.employeeId,
        (byEmployeeMap.get(row.employeeId) ?? 0) + row.workMinutesEstimated,
      );
    }
    const capability = row.capability ?? "unknown";
    byCapabilityMap.set(
      capability,
      (byCapabilityMap.get(capability) ?? 0) + row.workMinutesEstimated,
    );
    const workType = row.workType ?? row.sourceType;
    byWorkTypeMap.set(workType, (byWorkTypeMap.get(workType) ?? 0) + row.workMinutesEstimated);
  }

  const sortDesc = (a: { minutes: number }, b: { minutes: number }) => b.minutes - a.minutes;

  return {
    workspaceId,
    weekStart,
    totalEstimatedMinutes: Math.round(totalEstimatedMinutes * 100) / 100,
    totalEstimatedHours: Math.round((totalEstimatedMinutes / 60) * 100) / 100,
    byEmployee: [...byEmployeeMap.entries()]
      .map(([employeeId, minutes]) => ({ employeeId, minutes: Math.round(minutes * 100) / 100 }))
      .sort(sortDesc),
    byCapability: [...byCapabilityMap.entries()]
      .map(([capability, minutes]) => ({ capability, minutes: Math.round(minutes * 100) / 100 }))
      .sort(sortDesc),
    byWorkType: [...byWorkTypeMap.entries()]
      .map(([workType, minutes]) => ({ workType, minutes: Math.round(minutes * 100) / 100 }))
      .sort(sortDesc),
    mode: WORK_HOURS_SHADOW_MODE,
  };
}
