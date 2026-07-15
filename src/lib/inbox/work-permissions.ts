/**
 * Permission matrix for inbox → work actions (Slice D).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "@/lib/supabase/auth-server";
import {
  assertCanAccessRoom,
  getWorkspaceMemberRole,
  isRoomMember,
} from "@/lib/server/room-access";
import type { InboxAccess } from "./access";
import { isMayaEmployee } from "@/lib/maya-employee";

export type InboxWorkAction =
  | "start_room"
  | "link_room"
  | "link_topic"
  | "create_task"
  | "ask_employee"
  | "create_proposal"
  | "prepare_proposal"
  | "save_decision"
  | "save_memory"
  | "attach_deal"
  | "unlink";

export async function assertInboxWorkOrganize(access: InboxAccess): Promise<void> {
  if (!access.canOrganize && !access.canManage && !access.isAdmin) {
    throw new AuthError("You do not have permission to create work from inbox.", 403);
  }
}

export async function assertCanBridgeIntoRoom(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    userId: string;
  },
): Promise<string> {
  const role = await getWorkspaceMemberRole(client, params.workspaceId, params.userId);
  if (!role) throw new AuthError("You are not a member of this workspace.", 403);
  await assertCanAccessRoom(client, params.workspaceId, params.roomId, params.userId, role);
  return role;
}

export async function assertCanCreateRoom(
  client: SupabaseClient,
  params: { workspaceId: string; userId: string },
): Promise<string> {
  const role = await getWorkspaceMemberRole(client, params.workspaceId, params.userId);
  if (!role) throw new AuthError("You are not a member of this workspace.", 403);
  // Guests cannot create rooms.
  if (role === "guest") {
    throw new AuthError("Guests cannot create rooms from inbox.", 403);
  }
  return role;
}

export async function loadWorkAssignableEmployee(
  client: SupabaseClient,
  params: { workspaceId: string; employeeId: string },
): Promise<{ id: string; name: string; role: string; roleKey: string }> {
  const { data, error } = await client
    .from("ai_employees")
    .select("id, name, role, role_key, status, is_system_employee, system_employee_key, metadata")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.employeeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new AuthError("Employee not found or inactive.", 404);
  }
  const presenceOk = !data.status ||
    ["online", "idle", "working", "waiting_approval", "on_call", "active"].includes(
      String(data.status),
    );
  if (!presenceOk) {
    throw new AuthError("Employee is not available for inbox work.", 400);
  }
  if (
    isMayaEmployee({
      id: String(data.id),
      systemEmployeeKey: data.system_employee_key as string | undefined,
    }) ||
    data.is_system_employee ||
    data.system_employee_key
  ) {
    throw new AuthError(
      "Maya and system employees cannot own inbox work. Choose a hired AI employee.",
      400,
    );
  }
  const meta = (data.metadata as { dmOnly?: boolean; canBeAssignedToRooms?: boolean }) ?? {};
  if (meta.dmOnly || meta.canBeAssignedToRooms === false) {
    throw new AuthError("This employee cannot be assigned inbox work.", 400);
  }
  return {
    id: String(data.id),
    name: String(data.name ?? "Employee"),
    role: String(data.role ?? ""),
    roleKey: String(data.role_key ?? ""),
  };
}

export async function userIsRoomMemberOrAdmin(
  client: SupabaseClient,
  params: { workspaceId: string; roomId: string; userId: string; role: string },
): Promise<boolean> {
  if (params.role === "admin" || params.role === "owner") return true;
  return isRoomMember(client, params.workspaceId, params.roomId, params.userId);
}
