import type { SupabaseClient } from "@supabase/supabase-js";

/** Bump member + workspace access versions after grant/membership/role changes. */
export async function bumpMemberAccessVersion(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { error } = await client.rpc("bump_member_access_version", {
    target_workspace_id: workspaceId,
    target_user_id: userId,
  });
  if (error) throw error;
}

export async function bumpWorkspaceAccessVersion(
  client: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const { error } = await client.rpc("bump_workspace_access_version", {
    target_workspace_id: workspaceId,
  });
  if (error) throw error;
}
