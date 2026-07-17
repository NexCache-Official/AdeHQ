import type { SupabaseClient } from "@supabase/supabase-js";

const OFFLINE_REASON_WH = "wh_exhausted";

/**
 * Mark all AI employees offline when weekly Work Hours are exhausted.
 * Mid-task runs should finish first; call this after metering detects overage.
 */
export async function setWorkforceOffline(
  client: SupabaseClient,
  workspaceId: string,
  reason: string = OFFLINE_REASON_WH,
): Promise<number> {
  const { data, error } = await client
    .from("ai_employees")
    .update({
      status: "offline",
      current_task: null,
      last_active_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .neq("status", "offline")
    .neq("status", "working")
    .select("id");
  if (error) throw error;

  // Also force working → offline only when reason is hard pause after run completion paths
  // that explicitly pass forceWorking. Default leaves in-flight working alone.
  void reason;
  return data?.length ?? 0;
}

/** Force offline including employees currently marked working (post-run overage). */
export async function setWorkforceOfflineIncludingWorking(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await client
    .from("ai_employees")
    .update({
      status: "offline",
      current_task: null,
      last_active_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .neq("status", "offline")
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Restore AI employees from offline → idle when capacity has returned.
 */
export async function restoreWorkforceFromOffline(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await client
    .from("ai_employees")
    .update({
      status: "idle",
      last_active_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("status", "offline")
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * After a usage period update: offline if over allowance, else restore if capacity remains.
 */
export async function syncWorkforceToCapacity(
  client: SupabaseClient,
  workspaceId: string,
  params: { used: number; allowance: number; unlimited: boolean },
): Promise<"offline" | "online" | "unchanged"> {
  if (params.unlimited) {
    await restoreWorkforceFromOffline(client, workspaceId);
    return "online";
  }
  if (params.used >= params.allowance) {
    await setWorkforceOfflineIncludingWorking(client, workspaceId);
    return "offline";
  }
  if (params.used < params.allowance) {
    await restoreWorkforceFromOffline(client, workspaceId);
    return "online";
  }
  return "unchanged";
}
