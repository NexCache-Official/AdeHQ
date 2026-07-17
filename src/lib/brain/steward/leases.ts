import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkLease } from "./types-execution";

const DEFAULT_LEASE_MS = 10 * 60 * 1000;

function newLeaseId(): string {
  return `lease_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Claim an exclusive lease on a brain step. Expired leases can be reclaimed
 * with the same logical step (idempotency key stays on the step row).
 */
export async function claimStepLease(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    brainRunId: string;
    brainStepId: string;
    employeeId: string;
    agentRunId?: string | null;
    ttlMs?: number;
  },
): Promise<WorkLease | null> {
  const now = new Date();
  const expires = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_LEASE_MS));

  // Expire stale active leases for this step
  await client
    .from("brain_work_leases")
    .update({ status: "expired" })
    .eq("brain_step_id", input.brainStepId)
    .eq("status", "active")
    .lt("expires_at", now.toISOString());

  const { data: existing } = await client
    .from("brain_work_leases")
    .select("id, employee_id, expires_at, status")
    .eq("brain_step_id", input.brainStepId)
    .eq("status", "active")
    .maybeSingle();

  if (existing?.id) {
    if (String(existing.employee_id) === input.employeeId) {
      return heartbeatLease(client, String(existing.id));
    }
    return null;
  }

  const id = newLeaseId();
  const row = {
    id,
    workspace_id: input.workspaceId,
    brain_run_id: input.brainRunId,
    brain_step_id: input.brainStepId,
    employee_id: input.employeeId,
    leased_at: now.toISOString(),
    expires_at: expires.toISOString(),
    heartbeat_at: now.toISOString(),
    status: "active" as const,
    agent_run_id: input.agentRunId ?? null,
  };

  const { error } = await client.from("brain_work_leases").insert(row);
  if (error) {
    if (error.code === "23505") return null;
    throw error;
  }

  await client
    .from("brain_capability_steps")
    .update({
      status: "leased",
      assigned_employee_id: input.employeeId,
      lease_expires_at: expires.toISOString(),
      lease_heartbeat_at: now.toISOString(),
    })
    .eq("id", input.brainStepId)
    .in("status", ["queued", "pending"]);

  return {
    id,
    brainStepId: input.brainStepId,
    employeeId: input.employeeId,
    leasedAt: row.leased_at,
    expiresAt: row.expires_at,
    heartbeatAt: row.heartbeat_at,
    status: "active",
    agentRunId: input.agentRunId ?? undefined,
  };
}

export async function heartbeatLease(
  client: SupabaseClient,
  leaseId: string,
  ttlMs = DEFAULT_LEASE_MS,
): Promise<WorkLease | null> {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  const { data, error } = await client
    .from("brain_work_leases")
    .update({
      heartbeat_at: now.toISOString(),
      expires_at: expires.toISOString(),
    })
    .eq("id", leaseId)
    .eq("status", "active")
    .select("id, brain_step_id, employee_id, leased_at, expires_at, heartbeat_at, status, agent_run_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  await client
    .from("brain_capability_steps")
    .update({
      lease_expires_at: expires.toISOString(),
      lease_heartbeat_at: now.toISOString(),
    })
    .eq("id", data.brain_step_id);

  return {
    id: String(data.id),
    brainStepId: String(data.brain_step_id),
    employeeId: String(data.employee_id),
    leasedAt: String(data.leased_at),
    expiresAt: String(data.expires_at),
    heartbeatAt: String(data.heartbeat_at),
    status: "active",
    agentRunId: data.agent_run_id ? String(data.agent_run_id) : undefined,
  };
}

export async function releaseLease(
  client: SupabaseClient,
  leaseId: string,
  status: "released" | "expired" = "released",
): Promise<void> {
  await client
    .from("brain_work_leases")
    .update({ status })
    .eq("id", leaseId)
    .eq("status", "active");
}

export async function releaseLeasesForRun(
  client: SupabaseClient,
  brainRunId: string,
): Promise<void> {
  await client
    .from("brain_work_leases")
    .update({ status: "released" })
    .eq("brain_run_id", brainRunId)
    .eq("status", "active");
}
