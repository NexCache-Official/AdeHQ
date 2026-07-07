// ===========================================================================
// integration_tool_runs persistence — the auditable execution backbone.
// ===========================================================================

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IntegrationToolRunRecord,
  ToolCallMode,
  ToolExecutionContext,
  ToolPreview,
} from "./types";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

export function toolRunFromRow(row: DbRow): IntegrationToolRunRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    employeeId: String(row.employee_id),
    requestedByUserId: row.requested_by_user_id ? String(row.requested_by_user_id) : undefined,
    roomId: row.room_id ? String(row.room_id) : undefined,
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    agentRunId: row.agent_run_id ? String(row.agent_run_id) : undefined,
    triggerMessageId: row.trigger_message_id ? String(row.trigger_message_id) : undefined,
    capabilityDomain: String(row.capability_domain),
    toolName: String(row.tool_name),
    provider: String(row.provider ?? "adehq"),
    connectionId: row.connection_id ? String(row.connection_id) : undefined,
    approvalId: row.approval_id ? String(row.approval_id) : undefined,
    jobId: row.job_id ? String(row.job_id) : undefined,
    mode: row.mode as ToolCallMode,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    inputPayload: (row.input_payload as Record<string, unknown>) ?? {},
    outputPayload: (row.output_payload as Record<string, unknown> | null) ?? undefined,
    previewSnapshot: (row.preview_snapshot as Record<string, unknown> | null) ?? undefined,
    status: row.status as IntegrationToolRunRecord["status"],
    externalObjectId: row.external_object_id ? String(row.external_object_id) : undefined,
    externalUrl: row.external_url ? String(row.external_url) : undefined,
    costUsd: Number(row.cost_usd ?? 0),
    workMinutes: Number(row.work_minutes ?? 0),
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

/** Canonical JSON — stable key order so idempotency hashes are deterministic. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

export function buildIdempotencyKey(parts: {
  scope: string;
  tool: string;
  args: Record<string, unknown>;
}): string {
  return createHash("sha256")
    .update(`${parts.scope}:${parts.tool}:${canonicalJson(parts.args)}`)
    .digest("hex");
}

export async function findToolRunByIdempotencyKey(
  client: SupabaseClient,
  workspaceId: string,
  idempotencyKey: string,
): Promise<IntegrationToolRunRecord | null> {
  const { data, error } = await client
    .from("integration_tool_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", idempotencyKey)
    .in("status", ["pending", "running", "success"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toolRunFromRow(data as DbRow) : null;
}

export type CreateToolRunParams = {
  ctx: ToolExecutionContext;
  capabilityDomain: string;
  toolName: string;
  provider?: string;
  mode: ToolCallMode;
  status: IntegrationToolRunRecord["status"];
  inputPayload: Record<string, unknown>;
  previewSnapshot?: ToolPreview;
  approvalId?: string;
  idempotencyKey?: string;
  costUsd?: number;
  workMinutes?: number;
};

export async function createToolRun(
  client: SupabaseClient,
  params: CreateToolRunParams,
): Promise<IntegrationToolRunRecord> {
  const { ctx } = params;
  const { data, error } = await client
    .from("integration_tool_runs")
    .insert({
      workspace_id: ctx.workspaceId,
      employee_id: ctx.employeeId,
      requested_by_user_id: ctx.requestedByUserId ?? null,
      room_id: ctx.roomId ?? null,
      topic_id: ctx.topicId ?? null,
      agent_run_id: ctx.agentRunId ?? null,
      trigger_message_id: ctx.triggerMessageId ?? null,
      capability_domain: params.capabilityDomain,
      tool_name: params.toolName,
      provider: params.provider ?? "adehq",
      approval_id: params.approvalId ?? null,
      mode: params.mode,
      idempotency_key: params.idempotencyKey ?? null,
      input_payload: params.inputPayload,
      preview_snapshot: params.previewSnapshot ?? null,
      status: params.status,
      cost_usd: params.costUsd ?? 0,
      work_minutes: params.workMinutes ?? 0,
      completed_at: params.status === "success" || params.status === "failed" || params.status === "blocked" ? nowISO() : null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return toolRunFromRow(data as DbRow);
}

export type FinalizeToolRunParams = {
  toolRunId: string;
  workspaceId: string;
  status: "success" | "failed" | "blocked";
  outputPayload?: Record<string, unknown>;
  externalObjectId?: string;
  externalUrl?: string;
  jobId?: string;
  costUsd?: number;
  workMinutes?: number;
  errorMessage?: string;
};

export async function finalizeToolRun(
  client: SupabaseClient,
  params: FinalizeToolRunParams,
): Promise<void> {
  const update: DbRow = {
    status: params.status,
    completed_at: nowISO(),
  };
  if (params.outputPayload !== undefined) update.output_payload = params.outputPayload;
  if (params.externalObjectId !== undefined) update.external_object_id = params.externalObjectId;
  if (params.externalUrl !== undefined) update.external_url = params.externalUrl;
  if (params.jobId !== undefined) update.job_id = params.jobId;
  if (params.costUsd !== undefined) update.cost_usd = params.costUsd;
  if (params.workMinutes !== undefined) update.work_minutes = params.workMinutes;
  if (params.errorMessage !== undefined) update.error_message = params.errorMessage;

  const { error } = await client
    .from("integration_tool_runs")
    .update(update)
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.toolRunId);
  if (error) throw error;
}

export async function getToolRun(
  client: SupabaseClient,
  workspaceId: string,
  toolRunId: string,
): Promise<IntegrationToolRunRecord | null> {
  const { data, error } = await client
    .from("integration_tool_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", toolRunId)
    .maybeSingle();
  if (error) throw error;
  return data ? toolRunFromRow(data as DbRow) : null;
}
