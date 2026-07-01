import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelStatus, ProjectRoom, RoomKind } from "@/lib/types";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

export function channelFromRow(row: DbRow): ProjectRoom {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as RoomKind,
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
    status: (row.status as ChannelStatus) ?? "active",
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}

export async function loadChannel(
  client: SupabaseClient,
  workspaceId: string,
  channelId: string,
): Promise<ProjectRoom | null> {
  const { data, error } = await client
    .from("channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", channelId)
    .maybeSingle();
  if (error) throw error;
  return data ? channelFromRow(data as DbRow) : null;
}

export async function assertChannelActive(
  client: SupabaseClient,
  workspaceId: string,
  channelId: string,
): Promise<ProjectRoom> {
  const channel = await loadChannel(client, workspaceId, channelId);
  if (!channel) {
    throw new Error("Channel not found.");
  }
  if (channel.status === "archived") {
    throw new Error("This channel is archived.");
  }
  return channel;
}

/** Hard-delete a group channel and all associated data (cascade). DMs cannot be deleted here. */
export async function permanentlyDeleteChannel(
  client: SupabaseClient,
  workspaceId: string,
  channelId: string,
): Promise<void> {
  const channel = await loadChannel(client, workspaceId, channelId);
  if (!channel) return;
  if (channel.kind === "dm") {
    throw new Error("Direct messages cannot be permanently deleted from the channels page.");
  }

  const { error } = await client
    .from("channels")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", channelId);
  if (error) throw error;
}
