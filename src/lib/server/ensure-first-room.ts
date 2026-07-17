import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { nowISO, uid } from "@/lib/utils";

export type EnsureFirstRoomInput = {
  workspaceId: string;
  userId: string;
  name: string;
  accent?: string;
  description?: string;
};

export type EnsureFirstRoomResult = {
  roomId: string;
  roomName: string;
  created: boolean;
};

/**
 * Idempotent first project-room provision for onboarding.
 * Returns any existing active group room; otherwise inserts one.
 */
export async function ensureFirstProjectRoom(
  client: SupabaseClient,
  input: EnsureFirstRoomInput,
): Promise<EnsureFirstRoomResult> {
  const workspaceId = input.workspaceId;
  const desiredName = input.name.trim() || "Launch Room";

  const { data: existing, error: findError } = await client
    .from("rooms")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("kind", "room")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    await ensureGeneralTopic(client, workspaceId, String(existing.id));
    return {
      roomId: String(existing.id),
      roomName: String(existing.name),
      created: false,
    };
  }

  const timestamp = nowISO();
  const roomId = uid("room");
  const description = input.description?.trim() || `${desiredName} workstream`;
  const accent = input.accent?.trim() || "#f97316";

  const { error: insertError } = await client.from("rooms").insert({
    workspace_id: workspaceId,
    id: roomId,
    name: desiredName,
    kind: "room",
    dm_employee_id: null,
    dm_owner_user_id: null,
    dm_peer_user_id: null,
    dm_pair_key: null,
    // Group rooms require a non-null visibility (rooms_kind_shape).
    room_visibility: "workspace",
    description,
    brief: "",
    unread: 0,
    accent,
    status: "active",
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (insertError) {
    // Concurrent insert — re-fetch the winner.
    if (insertError.code === "23505") {
      const { data: raced, error: racedError } = await client
        .from("rooms")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .eq("kind", "room")
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (racedError) throw racedError;
      if (raced) {
        await ensureGeneralTopic(client, workspaceId, String(raced.id));
        return {
          roomId: String(raced.id),
          roomName: String(raced.name),
          created: false,
        };
      }
    }
    // No unique constraint on name — another concurrent first-room insert may
    // have won without a PK conflict. Prefer any active room that appeared.
    const { data: afterRace, error: afterError } = await client
      .from("rooms")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .eq("kind", "room")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (afterError) throw afterError;
    if (afterRace && String(afterRace.id) !== roomId) {
      await ensureGeneralTopic(client, workspaceId, String(afterRace.id));
      return {
        roomId: String(afterRace.id),
        roomName: String(afterRace.name),
        created: false,
      };
    }
    throw insertError;
  }

  await client.from("room_members").upsert(
    {
      workspace_id: workspaceId,
      room_id: roomId,
      member_type: "human",
      member_id: input.userId,
    },
    { onConflict: "workspace_id,room_id,member_type,member_id", ignoreDuplicates: true },
  );

  const general = await ensureGeneralTopic(client, workspaceId, roomId);
  const messageId = uid("msg");
  await client.from("messages").insert({
    workspace_id: workspaceId,
    id: messageId,
    room_id: roomId,
    topic_id: general.id,
    sender_type: "system",
    sender_id: "system",
    sender_name: "AdeHQ",
    content: `Your ${desiredName} workstream is ready.`,
    mentions: [],
    mentions_json: [],
    pending: false,
    created_at: timestamp,
  });

  // Final race check: if another room was also inserted, keep the oldest.
  const { data: oldest, error: oldestError } = await client
    .from("rooms")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("kind", "room")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (oldestError) throw oldestError;
  if (oldest && String(oldest.id) !== roomId) {
    await client
      .from("rooms")
      .update({ status: "archived", updated_at: nowISO() })
      .eq("workspace_id", workspaceId)
      .eq("id", roomId);
    await ensureGeneralTopic(client, workspaceId, String(oldest.id));
    return {
      roomId: String(oldest.id),
      roomName: String(oldest.name),
      created: false,
    };
  }

  return { roomId, roomName: desiredName, created: true };
}
