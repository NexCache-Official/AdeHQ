import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectRoom, RoomKind, RoomStatus } from "@/lib/types";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

export function roomFromRow(row: DbRow): ProjectRoom {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind ?? "room") as RoomKind,
    dmEmployeeId: row.dm_employee_id ? String(row.dm_employee_id) : undefined,
    description: String(row.description ?? ""),
    brief: String(row.brief ?? ""),
    humans: [],
    aiEmployees: [],
    messages: [],
    tasks: [],
    memory: [],
    unread: Number(row.unread ?? 0),
    accent: String(row.accent ?? "#f97316"),
    status: (row.status as RoomStatus) ?? "active",
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}

export async function loadRoom(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<ProjectRoom | null> {
  const { data, error } = await client
    .from("rooms")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw error;
  return data ? roomFromRow(data as DbRow) : null;
}

export async function assertRoomActive(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<ProjectRoom> {
  const room = await loadRoom(client, workspaceId, roomId);
  if (!room) {
    throw new Error("Room not found.");
  }
  if (room.status === "archived") {
    throw new Error("This room is archived.");
  }
  return room;
}

/** Hard-delete a group room and all associated data (cascade). DMs cannot be deleted here. */
export async function permanentlyDeleteRoom(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<void> {
  const room = await loadRoom(client, workspaceId, roomId);
  if (!room) return;
  if (room.kind === "dm") {
    throw new Error("Direct messages cannot be permanently deleted from the rooms page.");
  }

  const { error } = await client
    .from("rooms")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", roomId);
  if (error) throw error;
}
