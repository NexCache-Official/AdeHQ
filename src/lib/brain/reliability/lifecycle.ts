import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CATALOG_VERSION,
  DECISION_VERSION,
  PACKET_VERSION,
  ROUTER_VERSION,
  type BrainIntensity,
} from "@/lib/brain/catalog";
import { completeBrainRun, newBrainRunId, newCapabilityStepId } from "@/lib/brain/decisions/persist";
import { buildPermissionEnvelope } from "./permission-envelope";
import { buildStepIdempotencyKey } from "./idempotency";
import type {
  BrainRunLifecycleStatus,
  BrainStepCapability,
  BrainStepLifecycleStatus,
  PermissionEnvelope,
  RunBudget,
} from "./types";

export async function beginUnifiedBrainRun(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    initiatedByUserId: string;
    leadEmployeeId?: string | null;
    roomId?: string | null;
    topicId?: string | null;
    triggerMessageId?: string | null;
    intensity: BrainIntensity;
    budget?: Partial<RunBudget>;
    agentRunId?: string | null;
  },
): Promise<{ brainRunId: string; permissionEnvelope: PermissionEnvelope }> {
  const brainRunId = newBrainRunId();
  const permissionEnvelope = await buildPermissionEnvelope(client, {
    humanUserId: input.initiatedByUserId,
    workspaceId: input.workspaceId,
    aiEmployeeId: input.leadEmployeeId,
    roomId: input.roomId,
    topicId: input.topicId,
  });

  const estimatedWhMin = input.budget?.estimatedWhMin ?? 0;
  const estimatedWhMax = input.budget?.estimatedWhMax ?? 0;
  const hardWhLimit = input.budget?.hardWhLimit ?? input.budget?.approvedWhLimit ?? 50;

  const { error } = await client.from("brain_runs").insert({
    id: brainRunId,
    workspace_id: input.workspaceId,
    employee_id: input.leadEmployeeId ?? null,
    room_id: input.roomId ?? null,
    topic_id: input.topicId ?? null,
    trigger_message_id: input.triggerMessageId ?? null,
    intensity: input.intensity,
    packet_version: PACKET_VERSION,
    decision_version: DECISION_VERSION,
    router_version: ROUTER_VERSION,
    catalog_version: CATALOG_VERSION,
    status: "running",
    initiated_by_user_id: input.initiatedByUserId,
    lifecycle_status: "running" satisfies BrainRunLifecycleStatus,
    estimated_wh_min: estimatedWhMin,
    estimated_wh_max: estimatedWhMax,
    hard_wh_limit: hardWhLimit,
    actual_wh: 0,
    permission_version: permissionEnvelope.accessVersion,
    permission_envelope: permissionEnvelope,
    agent_run_id: input.agentRunId ?? null,
    metadata: {
      reliability: "pr17_5",
    },
  });
  if (error) throw error;

  return { brainRunId, permissionEnvelope };
}

export async function enqueueBrainStep(
  client: SupabaseClient,
  input: {
    brainRunId: string;
    decisionAttemptId: string;
    capability: BrainStepCapability | string;
    routeId: string;
    assignedEmployeeId?: string | null;
    logicalStepKey: string;
    workspaceId: string;
    estimatedWh?: number;
    outputContract: Record<string, unknown>;
    maxCostUsd: number;
  },
): Promise<{ stepId: string; idempotencyKey: string }> {
  const stepId = newCapabilityStepId();
  const idempotencyKey = buildStepIdempotencyKey({
    workspaceId: input.workspaceId,
    brainRunId: input.brainRunId,
    capability: String(input.capability),
    employeeId: input.assignedEmployeeId,
    logicalStepKey: input.logicalStepKey,
  });

  // Idempotent: if a step with this key already exists, return it
  const { data: existing } = await client
    .from("brain_capability_steps")
    .select("id, idempotency_key")
    .eq("brain_run_id", input.brainRunId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing?.id) {
    return { stepId: String(existing.id), idempotencyKey };
  }

  const { error } = await client.from("brain_capability_steps").insert({
    id: stepId,
    brain_run_id: input.brainRunId,
    decision_attempt_id: input.decisionAttemptId,
    capability: input.capability,
    route_id: input.routeId,
    dependencies: [],
    input_artifact_ids: [],
    output_contract: input.outputContract,
    estimated_min_cost_usd: 0,
    estimated_likely_cost_usd: 0,
    estimated_max_cost_usd: input.maxCostUsd,
    max_cost_usd: input.maxCostUsd,
    approval_required: false,
    route_stickiness: "task",
    status: "queued" satisfies BrainStepLifecycleStatus,
    assigned_employee_id: input.assignedEmployeeId ?? null,
    idempotency_key: idempotencyKey,
    estimated_wh: input.estimatedWh ?? 0,
    actual_wh: 0,
    input_contract_version: 1,
    output_contract_version: 1,
  });
  if (error) {
    // Unique race on idempotency key
    if (error.code === "23505") {
      const { data: raced } = await client
        .from("brain_capability_steps")
        .select("id")
        .eq("brain_run_id", input.brainRunId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (raced?.id) return { stepId: String(raced.id), idempotencyKey };
    }
    throw error;
  }

  return { stepId, idempotencyKey };
}

export async function cancelBrainRun(
  client: SupabaseClient,
  brainRunId: string,
): Promise<void> {
  await client
    .from("brain_capability_steps")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("brain_run_id", brainRunId)
    .in("status", ["queued", "leased", "pending", "running", "waiting_for_approval"]);

  await client
    .from("brain_runs")
    .update({
      status: "cancelled",
      lifecycle_status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("id", brainRunId)
    .in("status", ["running", "blocked"]);

  // Keep completeBrainRun for legacy status column sync
  try {
    await completeBrainRun(client, brainRunId, "cancelled");
  } catch {
    /* already cancelled */
  }
}

export async function finishBrainRun(
  client: SupabaseClient,
  brainRunId: string,
  status: Extract<BrainRunLifecycleStatus, "completed" | "failed" | "cancelled">,
  actualWh?: number,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
    lifecycle_status: status,
    completed_at: new Date().toISOString(),
  };
  if (actualWh != null) patch.actual_wh = actualWh;
  const { error } = await client.from("brain_runs").update(patch).eq("id", brainRunId);
  if (error) throw error;
}
