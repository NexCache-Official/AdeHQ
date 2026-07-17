import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionEnvelope } from "./types";
import {
  isBrainImageV1Enabled,
  isBrainSearchV1Enabled,
  isBrainStewardV1Enabled,
  isBrainVideoV1Enabled,
  isBrainVisionV1Enabled,
  isBrainVoiceV1Enabled,
} from "@/lib/brain/flags";

/**
 * Build an immutable permission envelope stamped onto a Brain run at plan time.
 * Sensitive steps must revalidate accessVersion before side effects.
 */
export async function buildPermissionEnvelope(
  client: SupabaseClient,
  params: {
    humanUserId: string;
    workspaceId: string;
    aiEmployeeId?: string | null;
    roomId?: string | null;
    topicId?: string | null;
  },
): Promise<PermissionEnvelope> {
  const { data: member } = await client
    .from("workspace_members")
    .select("access_version, role, status")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.humanUserId)
    .maybeSingle();

  const accessVersion = Number(member?.access_version ?? 1);
  const permittedCapabilities: string[] = ["reasoning"];
  if (isBrainSearchV1Enabled()) permittedCapabilities.push("search");
  if (isBrainVisionV1Enabled()) permittedCapabilities.push("vision");
  if (isBrainImageV1Enabled()) permittedCapabilities.push("image");
  if (isBrainVideoV1Enabled()) permittedCapabilities.push("video");
  if (isBrainVoiceV1Enabled()) {
    permittedCapabilities.push("speech_to_text", "text_to_speech");
  }
  if (isBrainStewardV1Enabled()) permittedCapabilities.push("synthesis");
  permittedCapabilities.push("tool", "coding");

  const permittedResources: string[] = [];
  const prohibitedResources: string[] = [];

  if (params.roomId) {
    const { data: room } = await client
      .from("rooms")
      .select("kind, dm_owner_user_id, dm_peer_user_id, room_visibility")
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.roomId)
      .maybeSingle();

    if (room?.kind === "dm") {
      const owner = room.dm_owner_user_id ? String(room.dm_owner_user_id) : null;
      const peer = room.dm_peer_user_id ? String(room.dm_peer_user_id) : null;
      const party =
        owner === params.humanUserId || peer === params.humanUserId;
      if (party) {
        permittedResources.push(`room:${params.roomId}`);
      } else {
        prohibitedResources.push(`room:${params.roomId}`);
      }
      // Private DMs never cross into collaboration scopes
      prohibitedResources.push("scope:workspace_memory_from_private_dm");
    } else if (room) {
      permittedResources.push(`room:${params.roomId}`);
    }
  }

  if (params.topicId) {
    const { data: deny } = await client
      .from("topic_access_overrides")
      .select("access")
      .eq("workspace_id", params.workspaceId)
      .eq("topic_id", params.topicId)
      .eq("user_id", params.humanUserId)
      .maybeSingle();
    if (deny?.access === "denied") {
      prohibitedResources.push(`topic:${params.topicId}`);
    } else {
      permittedResources.push(`topic:${params.topicId}`);
    }
  }

  return {
    humanUserId: params.humanUserId,
    aiEmployeeId: params.aiEmployeeId ?? undefined,
    workspaceId: params.workspaceId,
    roomId: params.roomId ?? undefined,
    topicId: params.topicId ?? undefined,
    accessVersion,
    permittedCapabilities,
    permittedResources,
    prohibitedResources,
  };
}

export async function revalidatePermissionEnvelope(
  client: SupabaseClient,
  envelope: PermissionEnvelope,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: member } = await client
    .from("workspace_members")
    .select("access_version, status")
    .eq("workspace_id", envelope.workspaceId)
    .eq("user_id", envelope.humanUserId)
    .maybeSingle();

  if (!member || member.status === "removed") {
    return { ok: false, reason: "membership_revoked" };
  }
  if (Number(member.access_version ?? 1) !== envelope.accessVersion) {
    return { ok: false, reason: "access_version_changed" };
  }
  return { ok: true };
}
