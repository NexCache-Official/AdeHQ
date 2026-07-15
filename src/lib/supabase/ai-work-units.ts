import type { SupabaseClient } from "@supabase/supabase-js";
import { uid, nowISO } from "@/lib/utils";
import { recordShadowWorkMinutesFromWorkUnit } from "@/lib/ai/work-hours/ledger";
import { recordCostFromWorkUnit } from "@/lib/billing/costing/record-work-unit-cost";
import { maybeRunSoftCapSimulationForWorkUnit } from "@/lib/ai/work-hours/soft-cap-simulation";
import type { AiCapability, ProviderRoute, ReasoningProfile, RuntimeMode } from "@/lib/ai/runtime/types";
import type { EmployeeIntelligencePolicy } from "@/lib/types";

export type AiWorkUnitStatus =
  | "created"
  | "planned"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AiWorkUnitPriority = "low" | "normal" | "high";

export type { EmployeeIntelligencePolicy };

export type AiWorkUnit = {
  id: string;
  workspaceId: string;
  roomId?: string;
  topicId?: string;
  dmId?: string;
  employeeId?: string;
  userId?: string;
  workType: string;
  capability: AiCapability;
  objective?: string;
  status: AiWorkUnitStatus;
  priority: AiWorkUnitPriority;
  runtimeMode?: RuntimeMode;
  reasoningProfile?: ReasoningProfile;
  providerRoute?: ProviderRoute;
  providerName?: string;
  modelId?: string;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  estimatedWorkMinutes?: number;
  actualWorkMinutes?: number;
  metadata: Record<string, unknown>;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type DbRow = Record<string, unknown>;

function isMissingRelationError(error: unknown): boolean {
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
    msg.includes("ai_work_units") && msg.includes("does not exist") ||
    msg.includes("Could not find the table")
  );
}

function workUnitFromRow(row: DbRow): AiWorkUnit {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: row.room_id ? String(row.room_id) : undefined,
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    dmId: row.dm_id ? String(row.dm_id) : undefined,
    employeeId: row.employee_id ? String(row.employee_id) : undefined,
    userId: row.user_id ? String(row.user_id) : undefined,
    workType: String(row.work_type),
    capability: String(row.capability) as AiCapability,
    objective: row.objective ? String(row.objective) : undefined,
    status: String(row.status) as AiWorkUnitStatus,
    priority: (String(row.priority ?? "normal") as AiWorkUnitPriority) || "normal",
    runtimeMode: row.runtime_mode ? (String(row.runtime_mode) as RuntimeMode) : undefined,
    reasoningProfile: row.reasoning_profile
      ? (String(row.reasoning_profile) as ReasoningProfile)
      : undefined,
    providerRoute: row.provider_route
      ? (String(row.provider_route) as ProviderRoute)
      : undefined,
    providerName: row.provider_name ? String(row.provider_name) : undefined,
    modelId: row.model_id ? String(row.model_id) : undefined,
    estimatedCostUsd:
      row.estimated_cost_usd != null ? Number(row.estimated_cost_usd) : undefined,
    actualCostUsd: row.actual_cost_usd != null ? Number(row.actual_cost_usd) : undefined,
    estimatedWorkMinutes:
      row.estimated_work_minutes != null ? Number(row.estimated_work_minutes) : undefined,
    actualWorkMinutes:
      row.actual_work_minutes != null ? Number(row.actual_work_minutes) : undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? nowISO()),
  };
}

export function newAiWorkUnitId(): string {
  return uid("wu");
}

export async function createAiWorkUnit(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    workUnitId?: string;
    roomId?: string;
    topicId?: string;
    dmId?: string;
    employeeId?: string;
    userId?: string;
    workType: string;
    capability: AiCapability;
    objective?: string;
    status?: AiWorkUnitStatus;
    priority?: AiWorkUnitPriority;
    runtimeMode?: RuntimeMode;
    reasoningProfile?: ReasoningProfile;
    providerRoute?: ProviderRoute;
    providerName?: string;
    modelId?: string;
    estimatedCostUsd?: number;
    estimatedWorkMinutes?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<AiWorkUnit> {
  const id = params.workUnitId ?? newAiWorkUnitId();
  const payload = {
    id,
    workspace_id: params.workspaceId,
    room_id: params.roomId ?? null,
    topic_id: params.topicId ?? null,
    dm_id: params.dmId ?? null,
    employee_id: params.employeeId ?? null,
    user_id: params.userId ?? null,
    work_type: params.workType,
    capability: params.capability,
    objective: params.objective ?? null,
    status: params.status ?? "created",
    priority: params.priority ?? "normal",
    runtime_mode: params.runtimeMode ?? null,
    reasoning_profile: params.reasoningProfile ?? null,
    provider_route: params.providerRoute ?? null,
    provider_name: params.providerName ?? null,
    model_id: params.modelId ?? null,
    estimated_cost_usd: params.estimatedCostUsd ?? null,
    estimated_work_minutes: params.estimatedWorkMinutes ?? null,
    metadata: params.metadata ?? {},
    created_at: nowISO(),
    updated_at: nowISO(),
  };

  const { data, error } = await client.from("ai_work_units").insert(payload).select("*").single();
  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "ai_work_units table is not available. Apply migration 20260705120000_ai_runtime_v2_foundation.sql.",
      );
    }
    throw error;
  }

  const workUnit = workUnitFromRow(data as DbRow);
  void maybeRunSoftCapSimulationForWorkUnit(client, workUnit).catch((error) => {
    console.warn("[AdeHQ soft-cap simulation]", error);
  });
  return workUnit;
}

export async function getAiWorkUnit(
  client: SupabaseClient,
  workspaceId: string,
  workUnitId: string,
): Promise<AiWorkUnit | null> {
  const { data, error } = await client
    .from("ai_work_units")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", workUnitId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "ai_work_units table is not available. Apply migration 20260705120000_ai_runtime_v2_foundation.sql.",
      );
    }
    throw error;
  }

  return data ? workUnitFromRow(data as DbRow) : null;
}

export async function listAiWorkUnitsForWorkspace(
  client: SupabaseClient,
  workspaceId: string,
  options: {
    limit?: number;
    employeeId?: string;
    status?: AiWorkUnitStatus;
    capability?: AiCapability;
  } = {},
): Promise<AiWorkUnit[]> {
  let query = client
    .from("ai_work_units")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.employeeId) query = query.eq("employee_id", options.employeeId);
  if (options.status) query = query.eq("status", options.status);
  if (options.capability) query = query.eq("capability", options.capability);

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "ai_work_units table is not available. Apply migration 20260705120000_ai_runtime_v2_foundation.sql.",
      );
    }
    throw error;
  }

  return ((data as DbRow[] | null) ?? []).map(workUnitFromRow);
}

async function patchAiWorkUnit(
  client: SupabaseClient,
  workspaceId: string,
  workUnitId: string,
  patch: DbRow,
): Promise<AiWorkUnit> {
  const { data, error } = await client
    .from("ai_work_units")
    .update({ ...patch, updated_at: nowISO() })
    .eq("workspace_id", workspaceId)
    .eq("id", workUnitId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        "ai_work_units table is not available. Apply migration 20260705120000_ai_runtime_v2_foundation.sql.",
      );
    }
    throw error;
  }
  if (!data) throw new Error(`Work unit not found: ${workUnitId}`);
  return workUnitFromRow(data as DbRow);
}

export async function startAiWorkUnit(
  client: SupabaseClient,
  workspaceId: string,
  workUnitId: string,
  params?: {
    providerRoute?: ProviderRoute;
    providerName?: string;
    modelId?: string;
    runtimeMode?: RuntimeMode;
    reasoningProfile?: ReasoningProfile;
    metadata?: Record<string, unknown>;
  },
): Promise<AiWorkUnit> {
  const patch: DbRow = {
    status: "running",
    started_at: nowISO(),
    provider_route: params?.providerRoute ?? null,
    provider_name: params?.providerName ?? null,
    model_id: params?.modelId ?? null,
    runtime_mode: params?.runtimeMode ?? null,
    reasoning_profile: params?.reasoningProfile ?? null,
  };
  if (params?.metadata) patch.metadata = params.metadata;
  return patchAiWorkUnit(client, workspaceId, workUnitId, patch);
}

export async function completeAiWorkUnit(
  client: SupabaseClient,
  workspaceId: string,
  workUnitId: string,
  result?: {
    actualCostUsd?: number;
    actualWorkMinutes?: number;
    modelId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<AiWorkUnit> {
  const patch: DbRow = {
    status: "completed",
    completed_at: nowISO(),
    actual_cost_usd: result?.actualCostUsd ?? null,
    actual_work_minutes: result?.actualWorkMinutes ?? null,
  };
  if (result?.modelId) patch.model_id = result.modelId;
  if (result?.metadata) patch.metadata = result.metadata;
  const completed = await patchAiWorkUnit(client, workspaceId, workUnitId, patch);
  void recordShadowWorkMinutesFromWorkUnit(client, completed, {
    actualCostUsd: result?.actualCostUsd,
    metadata: result?.metadata,
  }).catch((error) => {
    console.warn("[AdeHQ work hours shadow]", error);
  });
  // Commercial cost ledger — primary billable capture hook.
  void recordCostFromWorkUnit(client, completed, {
    actualCostUsd: result?.actualCostUsd,
    metadata: result?.metadata,
  }).catch((error) => {
    console.warn("[AdeHQ cost ledger]", error);
  });
  return completed;
}

export async function failAiWorkUnit(
  client: SupabaseClient,
  workspaceId: string,
  workUnitId: string,
  errorMessage: string,
  result?: {
    actualCostUsd?: number;
    actualWorkMinutes?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<AiWorkUnit> {
  const patch: DbRow = {
    status: "failed",
    completed_at: nowISO(),
    error_message: errorMessage,
    actual_cost_usd: result?.actualCostUsd ?? null,
    actual_work_minutes: result?.actualWorkMinutes ?? null,
  };
  if (result?.metadata) patch.metadata = result.metadata;
  return patchAiWorkUnit(client, workspaceId, workUnitId, patch);
}

export async function cancelAiWorkUnit(
  client: SupabaseClient,
  workspaceId: string,
  workUnitId: string,
  reason?: string,
): Promise<AiWorkUnit> {
  return patchAiWorkUnit(client, workspaceId, workUnitId, {
    status: "cancelled",
    completed_at: nowISO(),
    error_message: reason ?? null,
  });
}
