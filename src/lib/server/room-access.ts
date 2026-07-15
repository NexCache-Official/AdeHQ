import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "@/lib/supabase/auth-server";
import { assertRoomActive } from "@/lib/server/room-helpers";

export async function getWorkspaceMemberRole(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("workspace_members")
    .select("role, status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.status === "removed") return null;
  return data.role as string;
}

export async function requireWorkspaceRole(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const role = await getWorkspaceMemberRole(client, workspaceId, userId);
  if (!role) throw new AuthError("You are not a member of this workspace.", 403);
  return role;
}

export async function isRoomMember(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("room_members")
    .select("member_id")
    .eq("workspace_id", workspaceId)
    .eq("room_id", roomId)
    .eq("member_type", "human")
    .eq("member_id", userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function assertCanAccessRoom(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  userId: string,
  role: string,
): Promise<void> {
  if (role === "admin" || role === "owner") return;

  const member = await isRoomMember(client, workspaceId, roomId, userId);
  if (!member) {
    throw new AuthError("You do not have access to this room.", 403);
  }
}

export async function assertCanSendRoomMessage(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  userId: string,
  role: string,
): Promise<void> {
  await assertCanAccessRoom(client, workspaceId, roomId, userId, role);
  await assertRoomActive(client, workspaceId, roomId);
}
