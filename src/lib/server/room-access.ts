import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "@/lib/supabase/auth-server";
import { assertRoomActive } from "@/lib/server/room-helpers";
import {
  assertEffectiveAiScope,
  canAccessRoom,
  canAccessTopic,
  canSendInRoom,
  type AiEmployeeAccessInput,
  type AiEmployeeUserGrant,
  type RoomAccessInput,
  type RoomVisibility,
} from "@/lib/workspace/access";
import { loadAiEmployeeAccess, loadAiGrant } from "@/lib/server/ensure-private-dm";
import { normalizeWorkspaceRole } from "@/lib/workspace/permissions";

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

async function loadRoomAccessInput(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  userId: string,
): Promise<RoomAccessInput> {
  const { data, error } = await client
    .from("rooms")
    .select("kind, room_visibility, dm_owner_user_id, dm_peer_user_id, dm_employee_id")
    .eq("workspace_id", workspaceId)
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError("Room not found.", 404);

  const member = await isRoomMember(client, workspaceId, roomId, userId);
  const visibility = (data.room_visibility ?? "workspace") as RoomVisibility;

  return {
    kind: String(data.kind),
    visibility,
    dmOwnerUserId: data.dm_owner_user_id ? String(data.dm_owner_user_id) : null,
    dmPeerUserId: data.dm_peer_user_id ? String(data.dm_peer_user_id) : null,
    dmEmployeeId: data.dm_employee_id ? String(data.dm_employee_id) : null,
    isRoomMember: member,
  };
}

export async function isTopicDeniedForUser(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("topic_access_overrides")
    .select("access")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.access === "denied";
}

export async function assertCanAccessRoom(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  userId: string,
  role: string,
): Promise<void> {
  const room = await loadRoomAccessInput(client, workspaceId, roomId, userId);
  const ok = canAccessRoom({
    actor: { userId, role: normalizeWorkspaceRole(role) },
    room,
  });
  if (!ok) {
    throw new AuthError("You do not have access to this room.", 403);
  }
}

export async function assertCanAccessTopic(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
  userId: string,
  role: string,
): Promise<void> {
  const room = await loadRoomAccessInput(client, workspaceId, roomId, userId);
  const topicDenied = await isTopicDeniedForUser(client, workspaceId, topicId, userId);
  const ok = canAccessTopic({
    actor: { userId, role: normalizeWorkspaceRole(role) },
    topic: { room, topicDenied },
  });
  if (!ok) {
    throw new AuthError("You do not have access to this topic.", 403);
  }
}

/** Human ∩ AI ∩ conversation scope for tooling / respond. */
export async function assertEffectiveAiAccess(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  userId: string,
  role: string,
  employeeId: string,
  topicId?: string | null,
): Promise<void> {
  const room = await loadRoomAccessInput(client, workspaceId, roomId, userId);
  const employee = await loadAiEmployeeAccess(client, workspaceId, employeeId);
  if (!employee) throw new AuthError("Employee not found.", 404);
  const grant = await loadAiGrant(client, workspaceId, userId, employeeId);
  const topicDenied = topicId
    ? await isTopicDeniedForUser(client, workspaceId, topicId, userId)
    : false;

  const result = assertEffectiveAiScope({
    actor: { userId, role: normalizeWorkspaceRole(role) },
    employee,
    grant,
    room,
    topicDenied,
  });
  if (!result.ok) {
    throw new AuthError("You do not have access to this AI employee in this conversation.", 403);
  }
}

export async function assertCanSendRoomMessage(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  userId: string,
  role: string,
): Promise<void> {
  const room = await loadRoomAccessInput(client, workspaceId, roomId, userId);
  let aiEmployee: AiEmployeeAccessInput | null = null;
  let grant: AiEmployeeUserGrant | null = null;

  if (room.kind === "dm" && room.dmEmployeeId) {
    aiEmployee = await loadAiEmployeeAccess(client, workspaceId, room.dmEmployeeId);
    grant = await loadAiGrant(client, workspaceId, userId, room.dmEmployeeId);
  }

  const ok = canSendInRoom({
    actor: { userId, role: normalizeWorkspaceRole(role) },
    room,
    aiEmployee,
    grant,
  });
  if (!ok) {
    throw new AuthError("You do not have access to this room.", 403);
  }
  await assertRoomActive(client, workspaceId, roomId);
}
