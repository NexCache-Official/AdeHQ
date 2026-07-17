import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "@/lib/supabase/auth-server";
import { getWorkspaceMemberRole } from "@/lib/server/room-access";
import { canManageAiEmployees } from "@/lib/workspace/permissions";

export async function requireHireAdmin(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const role = await getWorkspaceMemberRole(client, workspaceId, userId);
  if (!role) throw new AuthError("You are not a member of this workspace.", 403);
  if (!canManageAiEmployees(role)) {
    throw new AuthError("Only workspace admins can hire or manage AI employees.", 403);
  }
  return role;
}
