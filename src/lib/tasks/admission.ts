import type { SupabaseClient } from "@supabase/supabase-js";
import { CAPACITY_LIMITS, type WorkClass } from "@/lib/tasks/work-classes";

export type AdmissionDecision =
  | { admit: true; runningInteractive: number; queuedInteractive: number; runningHeavy: number }
  | {
      admit: false;
      reason: "interactive_capacity" | "heavy_capacity";
      queuePosition: number;
      runningInteractive: number;
      queuedInteractive: number;
      runningHeavy: number;
    };

type DbRow = Record<string, unknown>;

async function countEmployeeRuns(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
): Promise<{ runningInteractive: number; queuedInteractive: number }> {
  const { data, error } = await client
    .from("agent_runs")
    .select("id, status, run_metadata")
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employeeId)
    .in("status", ["queued", "waiting", "running"]);
  if (error) {
    console.warn("[admission] countEmployeeRuns failed", error);
    return { runningInteractive: 0, queuedInteractive: 0 };
  }
  const rows = (data as DbRow[] | null) ?? [];
  let runningInteractive = 0;
  let queuedInteractive = 0;
  for (const row of rows) {
    const meta = (row.run_metadata ?? {}) as Record<string, unknown>;
    const workClass = String(meta.workClass ?? "interactive");
    // Heavy/light background work does not consume the interactive reply lane.
    if (workClass === "heavy_artifact" || workClass === "light_parallel") continue;
    const status = String(row.status);
    if (status === "running") runningInteractive += 1;
    else queuedInteractive += 1;
  }
  return { runningInteractive, queuedInteractive };
}

async function countHeavyJobs(
  client: SupabaseClient,
  workspaceId: string,
  employeeId: string,
): Promise<number> {
  const { data, error } = await client
    .from("integration_jobs")
    .select("id, status, employee_id")
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employeeId)
    .in("status", ["queued", "running"]);
  if (error) {
    return 0;
  }
  return ((data as DbRow[] | null) ?? []).length;
}

/**
 * Per-employee admission control before spawning a new interactive agent run.
 * Heavy artifact work is gated separately so spam cannot stack model runs.
 */
export async function evaluateEmployeeAdmission(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId: string;
    workClass: WorkClass;
  },
): Promise<AdmissionDecision> {
  const { runningInteractive, queuedInteractive } = await countEmployeeRuns(
    client,
    params.workspaceId,
    params.employeeId,
  );
  const runningHeavy = await countHeavyJobs(
    client,
    params.workspaceId,
    params.employeeId,
  );

  if (params.workClass === "heavy_artifact") {
    if (runningHeavy >= CAPACITY_LIMITS.maxHeavyRunning) {
      return {
        admit: false,
        reason: "heavy_capacity",
        queuePosition: runningHeavy + 1,
        runningInteractive,
        queuedInteractive,
        runningHeavy,
      };
    }
    return { admit: true, runningInteractive, queuedInteractive, runningHeavy };
  }

  if (params.workClass === "light_parallel") {
    return { admit: true, runningInteractive, queuedInteractive, runningHeavy };
  }

  // interactive
  if (runningInteractive >= CAPACITY_LIMITS.maxInteractiveRunning) {
    const queuePosition = queuedInteractive + 1;
    if (queuedInteractive >= CAPACITY_LIMITS.maxInteractiveQueued) {
      return {
        admit: false,
        reason: "interactive_capacity",
        queuePosition,
        runningInteractive,
        queuedInteractive,
        runningHeavy,
      };
    }
    // Still allow queueing one more run up to maxQueued — but mark as capacity-deferred
    // when already running so callers can task-book + soft-queue instead of stacking.
    return {
      admit: false,
      reason: "interactive_capacity",
      queuePosition,
      runningInteractive,
      queuedInteractive,
      runningHeavy,
    };
  }

  return { admit: true, runningInteractive, queuedInteractive, runningHeavy };
}
