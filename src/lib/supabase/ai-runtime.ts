import type { SupabaseClient } from "@supabase/supabase-js";
import { uid, nowISO } from "@/lib/utils";
import {
  estimateCostForRun,
  getOutputTokenCap,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";

export type WorkspaceAiSettings = {
  workspaceId: string;
  aiEnabled: boolean;
  defaultProvider: string;
  dailyTokenLimit: number;
  dailyCostLimitUsd: number;
  employeeDailyTokenLimit: number;
  maxParallelRuns: number;
  maxOutputTokens: number;
  maxToolRunsPerTask: number;
  maxHandoffDepth: number;
};

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "blocked";

export type UsageStatus = "reserved" | "success" | "failed" | "blocked" | "fallback";

type DbRow = Record<string, unknown>;

const DEFAULT_SETTINGS: Omit<WorkspaceAiSettings, "workspaceId"> = {
  aiEnabled: true,
  defaultProvider: "siliconflow",
  dailyTokenLimit: 500_000,
  dailyCostLimitUsd: 5,
  employeeDailyTokenLimit: 100_000,
  maxParallelRuns: 3,
  maxOutputTokens: 4096,
  maxToolRunsPerTask: 10,
  maxHandoffDepth: 1,
};

function settingsFromRow(workspaceId: string, row: DbRow): WorkspaceAiSettings {
  return {
    workspaceId,
    aiEnabled: Boolean(row.ai_enabled ?? true),
    defaultProvider: String(row.default_provider ?? "siliconflow"),
    dailyTokenLimit: Number(row.daily_token_limit ?? DEFAULT_SETTINGS.dailyTokenLimit),
    dailyCostLimitUsd: Number(row.daily_cost_limit_usd ?? DEFAULT_SETTINGS.dailyCostLimitUsd),
    employeeDailyTokenLimit: Number(
      row.employee_daily_token_limit ?? DEFAULT_SETTINGS.employeeDailyTokenLimit,
    ),
    maxParallelRuns: Number(row.max_parallel_runs ?? DEFAULT_SETTINGS.maxParallelRuns),
    maxOutputTokens: Number(row.max_output_tokens ?? DEFAULT_SETTINGS.maxOutputTokens),
    maxToolRunsPerTask: Number(row.max_tool_runs_per_task ?? DEFAULT_SETTINGS.maxToolRunsPerTask),
    maxHandoffDepth: Number(row.max_handoff_depth ?? DEFAULT_SETTINGS.maxHandoffDepth),
  };
}

export async function loadWorkspaceAiSettings(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceAiSettings> {
  const { data, error } = await client
    .from("workspace_ai_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) throw error;
  if (data) return settingsFromRow(workspaceId, data as DbRow);

  const row = {
    workspace_id: workspaceId,
    ...DEFAULT_SETTINGS,
    default_provider: DEFAULT_SETTINGS.defaultProvider,
    daily_token_limit: DEFAULT_SETTINGS.dailyTokenLimit,
    daily_cost_limit_usd: DEFAULT_SETTINGS.dailyCostLimitUsd,
    employee_daily_token_limit: DEFAULT_SETTINGS.employeeDailyTokenLimit,
    max_parallel_runs: DEFAULT_SETTINGS.maxParallelRuns,
    max_output_tokens: DEFAULT_SETTINGS.maxOutputTokens,
    max_tool_runs_per_task: DEFAULT_SETTINGS.maxToolRunsPerTask,
    max_handoff_depth: DEFAULT_SETTINGS.maxHandoffDepth,
  };

  const { error: insertError } = await client.from("workspace_ai_settings").insert(row);
  if (insertError && !insertError.message.includes("duplicate")) throw insertError;

  return { workspaceId, ...DEFAULT_SETTINGS };
}

export async function updateWorkspaceAiSettings(
  client: SupabaseClient,
  workspaceId: string,
  patch: Partial<WorkspaceAiSettings>,
): Promise<WorkspaceAiSettings> {
  await loadWorkspaceAiSettings(client, workspaceId);

  const payload: DbRow = { updated_at: nowISO() };
  if (patch.aiEnabled !== undefined) payload.ai_enabled = patch.aiEnabled;
  if (patch.defaultProvider !== undefined) payload.default_provider = patch.defaultProvider;
  if (patch.dailyTokenLimit !== undefined) payload.daily_token_limit = patch.dailyTokenLimit;
  if (patch.dailyCostLimitUsd !== undefined) payload.daily_cost_limit_usd = patch.dailyCostLimitUsd;
  if (patch.employeeDailyTokenLimit !== undefined) {
    payload.employee_daily_token_limit = patch.employeeDailyTokenLimit;
  }
  if (patch.maxParallelRuns !== undefined) payload.max_parallel_runs = patch.maxParallelRuns;
  if (patch.maxOutputTokens !== undefined) payload.max_output_tokens = patch.maxOutputTokens;
  if (patch.maxToolRunsPerTask !== undefined) payload.max_tool_runs_per_task = patch.maxToolRunsPerTask;
  if (patch.maxHandoffDepth !== undefined) payload.max_handoff_depth = patch.maxHandoffDepth;

  const { error } = await client
    .from("workspace_ai_settings")
    .update(payload)
    .eq("workspace_id", workspaceId);
  if (error) throw error;

  return loadWorkspaceAiSettings(client, workspaceId);
}

export async function createAgentRun(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    runId: string;
    employeeId: string;
    roomId: string;
    triggerMessageId: string;
    provider: string;
    model: string;
    modelMode: ModelMode;
    status?: AgentRunStatus;
    estimatedCostUsd?: number;
  },
): Promise<string> {
  const { error } = await client.from("agent_runs").insert({
    workspace_id: params.workspaceId,
    id: params.runId,
    employee_id: params.employeeId,
    room_id: params.roomId,
    trigger_message_id: params.triggerMessageId,
    status: params.status ?? "running",
    provider: params.provider,
    model: params.model,
    model_mode: params.modelMode,
    estimated_cost_usd: params.estimatedCostUsd ?? 0,
    started_at: nowISO(),
  });
  if (error) throw error;
  return params.runId;
}

export async function completeAgentRun(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
  patch: {
    status: AgentRunStatus;
    responseMessageId?: string;
    actualCostUsd?: number;
    latencyMs?: number;
    errorMessage?: string;
  },
): Promise<void> {
  const { error } = await client
    .from("agent_runs")
    .update({
      status: patch.status,
      response_message_id: patch.responseMessageId ?? null,
      actual_cost_usd: patch.actualCostUsd ?? null,
      latency_ms: patch.latencyMs ?? null,
      error_message: patch.errorMessage ?? null,
      completed_at: nowISO(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", runId);
  if (error) throw error;
}

export async function reserveUsage(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    usageId: string;
    agentRunId: string;
    employeeId: string;
    roomId: string;
    triggerMessageId?: string;
    provider: string;
    model: string;
    modelMode: ModelMode;
    estimatedInputTokens: number;
    estimatedMaxOutputTokens: number;
    estimatedCostUsd: number;
  },
): Promise<string> {
  const { error } = await client.from("ai_usage_events").insert({
    id: params.usageId,
    workspace_id: params.workspaceId,
    agent_run_id: params.agentRunId,
    employee_id: params.employeeId,
    room_id: params.roomId,
    trigger_message_id: params.triggerMessageId ?? null,
    provider: params.provider,
    model: params.model,
    model_mode: params.modelMode,
    status: "reserved",
    estimated_input_tokens: params.estimatedInputTokens,
    estimated_max_output_tokens: params.estimatedMaxOutputTokens,
    estimated_cost_usd: params.estimatedCostUsd,
    created_at: nowISO(),
  });
  if (error) throw error;
  return params.usageId;
}

export async function finalizeUsage(
  client: SupabaseClient,
  usageId: string,
  patch: {
    status: UsageStatus;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    actualCostUsd?: number;
    latencyMs?: number;
    fallbackUsed?: boolean;
    errorMessage?: string;
    responseMessageId?: string;
  },
): Promise<void> {
  const { error } = await client
    .from("ai_usage_events")
    .update({
      status: patch.status,
      input_tokens: patch.inputTokens ?? 0,
      output_tokens: patch.outputTokens ?? 0,
      cached_tokens: patch.cachedTokens ?? 0,
      actual_cost_usd: patch.actualCostUsd ?? null,
      latency_ms: patch.latencyMs ?? null,
      fallback_used: patch.fallbackUsed ?? false,
      error_message: patch.errorMessage ?? null,
      response_message_id: patch.responseMessageId ?? null,
      finalized_at: nowISO(),
    })
    .eq("id", usageId);
  if (error) throw error;
}

export async function appendRunStep(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    agentRunId: string;
    roomId: string;
    employeeId: string;
    stepType:
      | "thinking"
      | "model_call"
      | "tool_call"
      | "memory_write"
      | "task_create"
      | "approval_request"
      | "error";
    title: string;
    summary?: string;
    status: "running" | "success" | "failed" | "skipped";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.from("agent_run_steps").insert({
    workspace_id: params.workspaceId,
    agent_run_id: params.agentRunId,
    room_id: params.roomId,
    employee_id: params.employeeId,
    step_type: params.stepType,
    title: params.title,
    summary: params.summary ?? "",
    status: params.status,
    metadata_json: params.metadata ?? {},
    started_at: nowISO(),
    completed_at: params.status !== "running" ? nowISO() : null,
  });
  if (error) throw error;
}

export async function linkArtifact(
  client: SupabaseClient,
  table: "tasks" | "memory_entries" | "approvals" | "work_log_events" | "messages",
  workspaceId: string,
  artifactId: string,
  agentRunId: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const column =
    table === "messages" ? "agent_run_id" : "created_by_run_id";
  const payload: DbRow = { [column]: agentRunId, ...extra };

  const { error } = await client
    .from(table)
    .update(payload)
    .eq("workspace_id", workspaceId)
    .eq("id", artifactId);
  if (error) throw error;
}

export async function sumTodayUsage(
  client: SupabaseClient,
  workspaceId: string,
  options: { employeeId?: string; includeReserved?: boolean } = {},
): Promise<{ tokens: number; cost: number }> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  let query = client
    .from("ai_usage_events")
    .select("input_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, status, estimated_input_tokens, estimated_max_output_tokens")
    .eq("workspace_id", workspaceId)
    .gte("created_at", startOfDay.toISOString());

  if (options.employeeId) {
    query = query.eq("employee_id", options.employeeId);
  }

  const { data, error } = await query;
  if (error) throw error;

  let tokens = 0;
  let cost = 0;

  for (const row of (data as DbRow[] | null) ?? []) {
    const status = String(row.status);
    if (status === "blocked") continue;
    if (status === "reserved" && !options.includeReserved) continue;

    if (status === "reserved") {
      tokens +=
        Number(row.estimated_input_tokens ?? 0) +
        Number(row.estimated_max_output_tokens ?? 0);
      cost += Number(row.estimated_cost_usd ?? 0);
    } else {
      tokens += Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0);
      cost += Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
    }
  }

  return { tokens, cost };
}

export function newAgentRunId(): string {
  return uid("run");
}

export function newUsageId(): string {
  return crypto.randomUUID();
}

export function buildRunEstimate(
  provider: string,
  modelMode: ModelMode,
  promptLength: number,
  workspaceMaxOutput?: number,
) {
  const modeCap = getOutputTokenCap(modelMode);
  const maxOutput = Math.min(modeCap, workspaceMaxOutput ?? modeCap);
  const model = resolveModel(provider, modelMode);
  const estimate = estimateCostForRun(model, promptLength, maxOutput);
  return { ...estimate, maxOutput, model, tokens: estimate.inputTokens + estimate.outputTokens };
}
