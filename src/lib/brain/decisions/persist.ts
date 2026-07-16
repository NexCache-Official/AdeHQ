import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CATALOG_VERSION,
  DECISION_VERSION,
  PACKET_VERSION,
  ROUTER_VERSION,
  type BrainIntensity,
} from "@/lib/brain/catalog";
import type { OutputContract } from "@/lib/brain/contracts";
import type { CognitivePacketAuditRecord } from "@/lib/brain/packet/cognitive-packet";

export type BrainRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type BrainDecisionAttemptStatus =
  | "running"
  | "accepted"
  | "failed"
  | "superseded";

export type EligibilityRejection = {
  routeId: string;
  reason: string;
};

export function newBrainRunId(): string {
  return `brun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newDecisionAttemptId(): string {
  return `bda_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newCapabilityStepId(): string {
  return `bcs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createBrainRun(
  client: SupabaseClient,
  input: {
    id?: string;
    workspaceId: string;
    employeeId?: string | null;
    roomId?: string | null;
    topicId?: string | null;
    triggerMessageId?: string | null;
    intensity: BrainIntensity;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const id = input.id ?? newBrainRunId();
  const { error } = await client.from("brain_runs").insert({
    id,
    workspace_id: input.workspaceId,
    employee_id: input.employeeId ?? null,
    room_id: input.roomId ?? null,
    topic_id: input.topicId ?? null,
    trigger_message_id: input.triggerMessageId ?? null,
    intensity: input.intensity,
    packet_version: PACKET_VERSION,
    decision_version: DECISION_VERSION,
    router_version: ROUTER_VERSION,
    catalog_version: CATALOG_VERSION,
    status: "running",
    metadata: input.metadata ?? {},
  });
  if (error) throw error;
  return id;
}

export async function insertDecisionAttempt(
  client: SupabaseClient,
  input: {
    id?: string;
    brainRunId: string;
    attemptNumber: number;
    reason: string;
    capability: string;
    intensity: BrainIntensity;
    routeId: string;
    eligibilityRejections?: EligibilityRejection[];
    scoreFactors?: Record<string, unknown> | null;
  },
): Promise<string> {
  const id = input.id ?? newDecisionAttemptId();
  const { error } = await client.from("brain_decision_attempts").insert({
    id,
    brain_run_id: input.brainRunId,
    attempt_number: input.attemptNumber,
    reason: input.reason,
    capability: input.capability,
    intensity: input.intensity,
    route_id: input.routeId,
    eligibility_rejections: input.eligibilityRejections ?? [],
    score_factors: input.scoreFactors ?? null,
    status: "running",
  });
  if (error) throw error;
  return id;
}

/**
 * Mark prior running/accepted attempts superseded; only status transitions allowed
 * on immutable decision rows (route_id/capability/intensity never updated).
 */
export async function supersedePriorAttempts(
  client: SupabaseClient,
  brainRunId: string,
  exceptAttemptId?: string,
): Promise<void> {
  let query = client
    .from("brain_decision_attempts")
    .update({ status: "superseded" })
    .eq("brain_run_id", brainRunId)
    .in("status", ["running", "accepted"]);
  if (exceptAttemptId) {
    query = query.neq("id", exceptAttemptId);
  }
  const { error } = await query;
  if (error) throw error;
}

export async function acceptDecisionAttempt(
  client: SupabaseClient,
  brainRunId: string,
  attemptId: string,
): Promise<void> {
  await supersedePriorAttempts(client, brainRunId, attemptId);
  const { error } = await client
    .from("brain_decision_attempts")
    .update({ status: "accepted" })
    .eq("id", attemptId)
    .eq("status", "running");
  if (error) throw error;
  await client
    .from("brain_runs")
    .update({ final_accepted_decision_id: attemptId })
    .eq("id", brainRunId);
}

export async function insertCapabilityStep(
  client: SupabaseClient,
  input: {
    id?: string;
    brainRunId: string;
    decisionAttemptId: string;
    capability: string;
    routeId: string;
    outputContract: OutputContract;
    estimatedMinCostUsd?: number;
    estimatedLikelyCostUsd?: number;
    estimatedMaxCostUsd?: number;
    maxCostUsd: number;
    approvalRequired?: boolean;
    routeAffinityKey?: string | null;
    routeStickiness?: "none" | "task" | "artifact" | "conversation";
    dependencies?: string[];
    inputArtifactIds?: string[];
  },
): Promise<string> {
  const id = input.id ?? newCapabilityStepId();
  const { error } = await client.from("brain_capability_steps").insert({
    id,
    brain_run_id: input.brainRunId,
    decision_attempt_id: input.decisionAttemptId,
    capability: input.capability,
    route_id: input.routeId,
    dependencies: input.dependencies ?? [],
    input_artifact_ids: input.inputArtifactIds ?? [],
    output_contract: input.outputContract,
    estimated_min_cost_usd: input.estimatedMinCostUsd ?? 0,
    estimated_likely_cost_usd: input.estimatedLikelyCostUsd ?? 0,
    estimated_max_cost_usd: input.estimatedMaxCostUsd ?? 0,
    max_cost_usd: input.maxCostUsd,
    approval_required: input.approvalRequired ?? false,
    route_affinity_key: input.routeAffinityKey ?? null,
    route_stickiness: input.routeStickiness ?? "task",
    status: "pending",
  });
  if (error) throw error;
  return id;
}

export async function completeBrainRun(
  client: SupabaseClient,
  brainRunId: string,
  status: Exclude<BrainRunStatus, "running">,
): Promise<void> {
  const { error } = await client
    .from("brain_runs")
    .update({ status, completed_at: new Date().toISOString() })
    .eq("id", brainRunId);
  if (error) throw error;
}

export async function persistPacketAudit(
  client: SupabaseClient,
  audit: CognitivePacketAuditRecord,
): Promise<void> {
  const { error } = await client.from("brain_packet_audits").insert({
    id: audit.id,
    brain_run_id: audit.brainRunId,
    workspace_id: audit.workspaceId,
    pricing_snapshot_id: audit.pricingSnapshotId ?? null,
    source_ids: audit.sourceIds,
    content_hashes: audit.contentHashes,
    excerpt_refs: audit.excerptRefs,
    decision_metadata: audit.decisionMetadata,
  });
  if (error) throw error;
}
