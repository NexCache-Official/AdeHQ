import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeWorkspaceRole } from "@/lib/workspace/permissions";

export type InviteAccessPreset = "full_member" | "standard_member" | "restricted_member";

/**
 * Apply invitation access package after workspace_members upsert.
 * - full_member: no restricted room inserts required (workspace rooms auth by membership)
 * - selected restricted/private rooms from invite_room_grants
 * - AI grants from invite_ai_employee_grants
 * - topic deny overrides
 */
export async function applyInviteAccessPackage(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    userId: string;
    inviteId: string;
    role: string;
    preset?: string | null;
  },
): Promise<void> {
  const preset = (params.preset ?? "full_member") as InviteAccessPreset;
  const role = normalizeWorkspaceRole(params.role);

  // AI grants from invite
  const { data: aiGrants, error: aiErr } = await client
    .from("invite_ai_employee_grants")
    .select("*")
    .eq("invite_id", params.inviteId);
  if (aiErr) throw aiErr;

  if (aiGrants?.length) {
    const rows = aiGrants.map((g) => ({
      workspace_id: params.workspaceId,
      user_id: params.userId,
      employee_id: String(g.employee_id),
      access_effect: g.access_effect === "deny" ? "deny" : "allow",
      can_dm: g.can_dm !== false,
      can_assign_work: g.can_assign_work !== false,
      can_view_shared_outputs: g.can_view_shared_outputs !== false,
      granted_by: null,
      granted_at: new Date().toISOString(),
    }));
    const { error } = await client
      .from("ai_employee_user_grants")
      .upsert(rows, { onConflict: "workspace_id,user_id,employee_id" });
    if (error) throw error;
  }

  // Restricted/private room memberships from invite
  const { data: roomGrants, error: roomErr } = await client
    .from("invite_room_grants")
    .select("room_id")
    .eq("invite_id", params.inviteId);
  if (roomErr) throw roomErr;

  if (roomGrants?.length) {
    const memberRows = roomGrants.map((g) => ({
      workspace_id: params.workspaceId,
      room_id: String(g.room_id),
      member_type: "human" as const,
      member_id: params.userId,
    }));
    const { error } = await client
      .from("room_members")
      .upsert(memberRows, { onConflict: "workspace_id,room_id,member_type,member_id" });
    if (error) throw error;

    const stateRows = roomGrants.map((g) => ({
      workspace_id: params.workspaceId,
      room_id: String(g.room_id),
      user_id: params.userId,
      updated_at: new Date().toISOString(),
    }));
    await client
      .from("room_user_state")
      .upsert(stateRows, { onConflict: "workspace_id,room_id,user_id" });
  }

  // For full_member with no explicit room grants: ensure room_user_state for workspace rooms (optional UX)
  if (preset === "full_member" && (!roomGrants || roomGrants.length === 0)) {
    const { data: workspaceRooms } = await client
      .from("rooms")
      .select("id")
      .eq("workspace_id", params.workspaceId)
      .neq("kind", "dm")
      .eq("room_visibility", "workspace")
      .eq("status", "active");

    if (workspaceRooms?.length) {
      const stateRows = workspaceRooms.map((r) => ({
        workspace_id: params.workspaceId,
        room_id: String(r.id),
        user_id: params.userId,
        updated_at: new Date().toISOString(),
      }));
      await client
        .from("room_user_state")
        .upsert(stateRows, { onConflict: "workspace_id,room_id,user_id" });
    }
  }

  const { data: topicGrants, error: topicErr } = await client
    .from("invite_topic_grants")
    .select("*")
    .eq("invite_id", params.inviteId);
  if (topicErr) throw topicErr;

  if (topicGrants?.length) {
    const rows = topicGrants.map((g) => ({
      workspace_id: params.workspaceId,
      topic_id: String(g.topic_id),
      user_id: params.userId,
      access: "denied" as const,
    }));
    const { error } = await client
      .from("topic_access_overrides")
      .upsert(rows, { onConflict: "workspace_id,topic_id,user_id" });
    if (error) throw error;
  }

  await client.from("access_audit_events").insert({
    workspace_id: params.workspaceId,
    actor_user_id: params.userId,
    event_type: "invite_access_applied",
    payload: { inviteId: params.inviteId, preset, role },
  });

  await client.rpc("bump_member_access_version", {
    target_workspace_id: params.workspaceId,
    target_user_id: params.userId,
  });
}

/**
 * Repair helper for legacy members: ensure room_user_state for all workspace-visible rooms.
 * Does not invent restricted memberships.
 */
export async function ensureMemberAccessFromGrants(
  client: SupabaseClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { data: rooms } = await client
    .from("rooms")
    .select("id")
    .eq("workspace_id", workspaceId)
    .neq("kind", "dm")
    .eq("room_visibility", "workspace")
    .eq("status", "active");

  if (!rooms?.length) return;

  const stateRows = rooms.map((r) => ({
    workspace_id: workspaceId,
    room_id: String(r.id),
    user_id: userId,
    updated_at: new Date().toISOString(),
  }));
  await client
    .from("room_user_state")
    .upsert(stateRows, { onConflict: "workspace_id,room_id,user_id" });
}
