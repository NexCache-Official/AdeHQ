import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthError } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom, assertEffectiveAiAccess } from "@/lib/server/room-access";
import { isMayaEmployee } from "@/lib/maya-employee";
import { ensureGeneralTopic } from "@/lib/server/topic-helpers";
import { upsertWorkGraphEdge } from "@/lib/inbox/work-graph";
import { uid } from "@/lib/utils";
import { resolveHumanCallEntitlements } from "./entitlements";
import { sendIncomingCallPush } from "./push";
import type {
  AiParticipationMode,
  CallArtifactType,
  CallSessionSummary,
  CallStatus,
  CloudflareTrackDescriptor,
} from "./types";

const ACTIVE_STATUSES = ["ringing", "connecting", "active", "reconnecting"];

export async function cleanupStaleCallState(
  service: SupabaseClient,
  workspaceId: string,
) {
  const now = new Date();
  const nowIso = now.toISOString();
  await service
    .from("call_participant_leases")
    .delete()
    .eq("workspace_id", workspaceId)
    .lte("lease_expires_at", nowIso);
  await service
    .from("call_invitations")
    .update({ status: "expired", responded_at: nowIso, updated_at: nowIso })
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .lte("expires_at", nowIso);
  await service
    .from("call_sessions")
    .update({ status: "missed", ended_at: nowIso, updated_at: nowIso })
    .eq("workspace_id", workspaceId)
    .eq("status", "ringing")
    .lte("created_at", new Date(now.getTime() - 45_000).toISOString());
  await service
    .from("call_sessions")
    .update({ status: "failed", ended_at: nowIso, updated_at: nowIso })
    .eq("workspace_id", workspaceId)
    .in("status", ["connecting", "reconnecting"])
    .lte("last_activity_at", new Date(now.getTime() - 5 * 60_000).toISOString());
}

function mapCall(row: Record<string, unknown>, participants: Record<string, unknown>[]): CallSessionSummary {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: String(row.room_id),
    kind: row.kind as CallSessionSummary["kind"],
    status: row.status as CallStatus,
    privacyMode: row.privacy_mode as CallSessionSummary["privacyMode"],
    title: String(row.title ?? "Call"),
    createdBy: row.created_by ? String(row.created_by) : null,
    audioEnabled: row.audio_enabled !== false,
    videoEnabled: Boolean(row.video_enabled),
    screenShareEnabled: Boolean(row.screen_share_enabled),
    participantLimit: Number(row.participant_limit ?? 2),
    startedAt: row.started_at ? String(row.started_at) : null,
    answeredAt: row.answered_at ? String(row.answered_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    createdAt: String(row.created_at),
    participants: participants.map((participant) => ({
      id: String(participant.id),
      participantType: participant.participant_type as "human" | "ai_employee",
      userId: participant.user_id ? String(participant.user_id) : null,
      employeeId: participant.employee_id ? String(participant.employee_id) : null,
      role: participant.role as "host" | "participant" | "observer",
      participationMode: (participant.participation_mode as AiParticipationMode | null) ?? null,
      state: String(participant.state),
      deviceId: participant.device_id ? String(participant.device_id) : null,
      muteState: Boolean(participant.mute_state),
      cameraState: Boolean(participant.camera_state),
      providerSessionId: participant.provider_session_id
        ? String(participant.provider_session_id)
        : null,
      publishedTracks: Array.isArray(participant.published_tracks)
        ? (participant.published_tracks as CloudflareTrackDescriptor[])
        : [],
    })),
  };
}

async function insertEvent(
  service: SupabaseClient,
  params: {
    workspaceId: string;
    callId: string;
    type: string;
    actorType?: "human" | "ai_employee" | "system";
    actorId?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  const { error } = await service.from("call_events").insert({
    workspace_id: params.workspaceId,
    id: uid("call_evt"),
    call_id: params.callId,
    event_type: params.type,
    actor_type: params.actorType ?? "system",
    actor_id: params.actorId ?? null,
    payload: params.payload ?? {},
  });
  if (error) throw error;
}

export async function getCall(
  service: SupabaseClient,
  workspaceId: string,
  callId: string,
): Promise<CallSessionSummary> {
  const [{ data: call, error }, { data: participants, error: participantError }] =
    await Promise.all([
      service
        .from("call_sessions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", callId)
        .maybeSingle(),
      service
        .from("call_participants")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("call_id", callId)
        .order("created_at"),
    ]);
  if (error) throw error;
  if (participantError) throw participantError;
  if (!call) throw new AuthError("Call not found.", 404);
  return mapCall(call as Record<string, unknown>, (participants ?? []) as Record<string, unknown>[]);
}

export async function listCalls(
  service: SupabaseClient,
  workspaceId: string,
  userId: string,
  limit = 50,
): Promise<CallSessionSummary[]> {
  await cleanupStaleCallState(service, workspaceId);
  const { data: participantRows, error: participantError } = await service
    .from("call_participants")
    .select("call_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .limit(200);
  if (participantError) throw participantError;
  const ids = [...new Set((participantRows ?? []).map((row) => String(row.call_id)))];
  if (!ids.length) return [];
  const { data: calls, error } = await service
    .from("call_sessions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("id", ids)
    .order("created_at", { ascending: false })
    .limit(Math.min(100, limit));
  if (error) throw error;
  const { data: participants, error: participantsError } = await service
    .from("call_participants")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("call_id", (calls ?? []).map((call) => String(call.id)));
  if (participantsError) throw participantsError;
  const byCall = new Map<string, Record<string, unknown>[]>();
  for (const participant of (participants ?? []) as Record<string, unknown>[]) {
    const id = String(participant.call_id);
    byCall.set(id, [...(byCall.get(id) ?? []), participant]);
  }
  return ((calls ?? []) as Record<string, unknown>[]).map((call) =>
    mapCall(call, byCall.get(String(call.id)) ?? []),
  );
}

export async function createHumanCall(
  service: SupabaseClient,
  authClient: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    creatorId: string;
    peerUserId: string;
    role: string;
    idempotencyKey: string;
    video?: boolean;
  },
) {
  await cleanupStaleCallState(service, params.workspaceId);
  await assertCanAccessRoom(
    authClient,
    params.workspaceId,
    params.roomId,
    params.creatorId,
    params.role,
  );
  const { data: room, error: roomError } = await service
    .from("rooms")
    .select("kind, dm_owner_user_id, dm_peer_user_id, dm_employee_id, name")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.roomId)
    .maybeSingle();
  if (roomError) throw roomError;
  if (
    !room ||
    room.kind !== "dm" ||
    room.dm_employee_id ||
    ![String(room.dm_owner_user_id), String(room.dm_peer_user_id)].includes(params.creatorId) ||
    ![String(room.dm_owner_user_id), String(room.dm_peer_user_id)].includes(params.peerUserId)
  ) {
    throw new AuthError("Human calls require a private human DM.", 422);
  }
  if (params.peerUserId === params.creatorId) throw new AuthError("Cannot call yourself.", 400);
  const { data: membership } = await service
    .from("workspace_members")
    .select("status")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.peerUserId)
    .maybeSingle();
  if (!membership || membership.status === "removed") {
    throw new AuthError("The person is no longer in this workspace.", 422);
  }

  const entitlements = await resolveHumanCallEntitlements(service, params.workspaceId);
  if (!entitlements.enabled || !entitlements.audioEnabled) {
    throw new AuthError("Human calls are not enabled for this workspace.", 403);
  }
  if (params.video && !entitlements.videoEnabled) {
    throw new AuthError("Video calls are not enabled for this workspace.", 403);
  }
  const { count, error: countError } = await service
    .from("call_sessions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", params.workspaceId)
    .in("status", ACTIVE_STATUSES);
  if (countError) throw countError;
  if ((count ?? 0) >= entitlements.maxConcurrentCallsPerWorkspace) {
    throw new AuthError("This workspace has reached its concurrent call limit.", 429);
  }

  const { data: existing, error: existingError } = await service
    .from("call_sessions")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return getCall(service, params.workspaceId, String(existing.id));

  const now = new Date();
  const callId = uid("call");
  const hostId = uid("call_part");
  const peerId = uid("call_part");
  const invitationId = uid("call_inv");
  const title = String(room.name ?? "Private call");
  const { error: insertError } = await service.from("call_sessions").insert({
    workspace_id: params.workspaceId,
    id: callId,
    room_id: params.roomId,
    kind: "human_human",
    status: "ringing",
    privacy_mode: "human_private",
    title,
    created_by: params.creatorId,
    idempotency_key: params.idempotencyKey,
    audio_enabled: true,
    video_enabled: Boolean(params.video),
    screen_share_enabled: entitlements.screenShareEnabled,
    participant_limit: 2,
  });
  if (insertError) throw insertError;
  const { error: participantsError } = await service.from("call_participants").insert([
    {
      workspace_id: params.workspaceId,
      id: hostId,
      call_id: callId,
      participant_type: "human",
      user_id: params.creatorId,
      role: "host",
      state: "accepted",
    },
    {
      workspace_id: params.workspaceId,
      id: peerId,
      call_id: callId,
      participant_type: "human",
      user_id: params.peerUserId,
      role: "participant",
      state: "ringing",
    },
  ]);
  if (participantsError) throw participantsError;
  const { error: invitationError } = await service.from("call_invitations").insert({
    workspace_id: params.workspaceId,
    id: invitationId,
    call_id: callId,
    inviter_user_id: params.creatorId,
    invitee_user_id: params.peerUserId,
    status: "pending",
    expires_at: new Date(now.getTime() + 40_000).toISOString(),
  });
  if (invitationError) throw invitationError;
  await insertEvent(service, {
    workspaceId: params.workspaceId,
    callId,
    type: "call.created",
    actorType: "human",
    actorId: params.creatorId,
  });
  await insertEvent(service, {
    workspaceId: params.workspaceId,
    callId,
    type: "call.ringing",
    actorType: "human",
    actorId: params.creatorId,
    payload: { invitationId, inviteeUserId: params.peerUserId },
  });
  await upsertWorkGraphEdge(service, {
    workspaceId: params.workspaceId,
    fromObjectType: "call",
    fromObjectId: callId,
    relationType: "occurred_in",
    toObjectType: "room",
    toObjectId: params.roomId,
  });
  try {
    await sendIncomingCallPush(service, {
      workspaceId: params.workspaceId,
      userId: params.peerUserId,
      callId,
      invitationId,
      title,
    });
  } catch (pushError) {
    console.warn("[AdeHQ calls] incoming push failed", pushError);
  }
  return {
    ...(await getCall(service, params.workspaceId, callId)),
    invitationId,
    entitlements,
  };
}

export async function acceptInvitation(
  service: SupabaseClient,
  params: {
    workspaceId: string;
    invitationId: string;
    userId: string;
    deviceId: string;
  },
) {
  const { data, error } = await service.rpc("accept_call_invitation", {
    p_workspace_id: params.workspaceId,
    p_invitation_id: params.invitationId,
    p_user_id: params.userId,
    p_device_id: params.deviceId,
    p_lease_seconds: 45,
  });
  if (error) throw error;
  const result = data as { won?: boolean; callId?: string; status?: string };
  if (result.won && result.callId) {
    await insertEvent(service, {
      workspaceId: params.workspaceId,
      callId: result.callId,
      type: "call.device_won",
      actorType: "human",
      actorId: params.userId,
      payload: { deviceId: params.deviceId },
    });
    await insertEvent(service, {
      workspaceId: params.workspaceId,
      callId: result.callId,
      type: "call.accepted",
      actorType: "human",
      actorId: params.userId,
    });
  }
  return result;
}

export async function updateCallState(
  service: SupabaseClient,
  params: {
    workspaceId: string;
    callId: string;
    userId: string;
    status: "active" | "reconnecting" | "declined" | "cancelled" | "ended" | "failed";
    deviceId?: string;
  },
) {
  const call = await getCall(service, params.workspaceId, params.callId);
  if (!call.participants.some((participant) => participant.userId === params.userId)) {
    throw new AuthError("Call not found.", 404);
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: params.status,
    last_activity_at: now,
    updated_at: now,
  };
  if (params.status === "active") patch.started_at = call.startedAt ?? now;
  if (["ended", "declined", "cancelled", "failed"].includes(params.status)) {
    patch.ended_at = now;
  }
  const { error } = await service
    .from("call_sessions")
    .update(patch)
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.callId);
  if (error) throw error;
  if (["ended", "declined", "cancelled", "failed"].includes(params.status)) {
    await service
      .from("call_participants")
      .update({ state: "left", left_at: now, updated_at: now })
      .eq("workspace_id", params.workspaceId)
      .eq("call_id", params.callId)
      .in("state", ["accepted", "joining", "joined"]);
    await service
      .from("call_invitations")
      .update({
        status: params.status === "declined" ? "declined" : "cancelled",
        responded_at: now,
        updated_at: now,
      })
      .eq("workspace_id", params.workspaceId)
      .eq("call_id", params.callId)
      .eq("status", "pending");
    await service
      .from("call_participant_leases")
      .delete()
      .eq("workspace_id", params.workspaceId)
      .eq("call_id", params.callId);
    await service
      .from("call_media_sessions")
      .update({ ended_at: now })
      .eq("workspace_id", params.workspaceId)
      .eq("call_id", params.callId)
      .is("ended_at", null);
    const { data: sessionRecordings } = await service
      .from("call_artifacts")
      .select("id, metadata")
      .eq("workspace_id", params.workspaceId)
      .eq("call_id", params.callId)
      .contains("metadata", {
        source: "call_recording",
        retentionPolicy: "session_only",
      });
    const recordingPaths = (sessionRecordings ?? [])
      .map((recording) =>
        String(((recording.metadata ?? {}) as Record<string, unknown>).storagePath ?? ""),
      )
      .filter(Boolean);
    if (recordingPaths.length) {
      await service.storage.from("call-recordings").remove(recordingPaths);
    }
    if (sessionRecordings?.length) {
      await service
        .from("call_artifacts")
        .delete()
        .eq("workspace_id", params.workspaceId)
        .in(
          "id",
          sessionRecordings.map((recording) => recording.id),
        );
    }
  }
  await insertEvent(service, {
    workspaceId: params.workspaceId,
    callId: params.callId,
    type: `call.${params.status}`,
    actorType: "human",
    actorId: params.userId,
  });
  return getCall(service, params.workspaceId, params.callId);
}

export async function heartbeatLease(
  service: SupabaseClient,
  params: { workspaceId: string; callId: string; userId: string; deviceId: string },
) {
  const now = new Date();
  const { data: existing, error: existingError } = await service
    .from("call_participant_leases")
    .select("call_id, lease_expires_at")
    .eq("workspace_id", params.workspaceId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (
    existing &&
    String(existing.call_id) !== params.callId &&
    new Date(String(existing.lease_expires_at)).getTime() > now.getTime()
  ) {
    throw new AuthError("You are already active in another call.", 409);
  }
  if (!existing || String(existing.call_id) !== params.callId) {
    const { data: participant, error: participantError } = await service
      .from("call_participants")
      .select("id")
      .eq("workspace_id", params.workspaceId)
      .eq("call_id", params.callId)
      .eq("user_id", params.userId)
      .maybeSingle();
    if (participantError) throw participantError;
    if (!participant) throw new AuthError("Call not found.", 404);
    const leaseExpiresAt = new Date(now.getTime() + 45_000).toISOString();
    const { error: insertError } = await service.from("call_participant_leases").upsert(
      {
        workspace_id: params.workspaceId,
        user_id: params.userId,
        call_id: params.callId,
        participant_id: participant.id,
        device_id: params.deviceId,
        heartbeat_at: now.toISOString(),
        lease_expires_at: leaseExpiresAt,
      },
      { onConflict: "workspace_id,user_id" },
    );
    if (insertError) throw insertError;
    return { leaseExpiresAt };
  }
  const { data, error } = await service
    .from("call_participant_leases")
    .update({
      heartbeat_at: now.toISOString(),
      lease_expires_at: new Date(now.getTime() + 45_000).toISOString(),
    })
    .eq("workspace_id", params.workspaceId)
    .eq("call_id", params.callId)
    .eq("user_id", params.userId)
    .eq("device_id", params.deviceId)
    .select("call_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError("This device no longer owns the call.", 409);
  return { leaseExpiresAt: new Date(now.getTime() + 45_000).toISOString() };
}

export async function inviteAiEmployee(
  service: SupabaseClient,
  authClient: SupabaseClient,
  params: {
    workspaceId: string;
    callId: string;
    roomId: string;
    userId: string;
    role: string;
    employeeId: string;
    mode: AiParticipationMode;
  },
) {
  await assertEffectiveAiAccess(
    authClient,
    params.workspaceId,
    params.roomId,
    params.userId,
    params.role,
    params.employeeId,
  );
  const { data: employee, error: employeeError } = await service
    .from("ai_employees")
    .select("id, system_employee_key")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.employeeId)
    .maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee || isMayaEmployee({ id: String(employee.id), systemEmployeeKey: employee.system_employee_key })) {
    throw new AuthError("Choose a hired AI employee.", 422);
  }
  const call = await getCall(service, params.workspaceId, params.callId);
  if (call.roomId !== params.roomId || !call.participants.some((p) => p.userId === params.userId)) {
    throw new AuthError("Call not found.", 404);
  }
  if (call.participants.length >= call.participantLimit) {
    throw new AuthError("This call has reached its participant limit.", 422);
  }
  const humans = call.participants.filter((participant) => participant.userId);
  const { data: consents, error: consentError } = await service
    .from("call_consents")
    .select("user_id")
    .eq("workspace_id", params.workspaceId)
    .eq("call_id", params.callId)
    .eq("consent_type", "ai_listening")
    .eq("granted", true);
  if (consentError) throw consentError;
  const consented = new Set((consents ?? []).map((consent) => String(consent.user_id)));
  if (!humans.every((participant) => consented.has(participant.userId!))) {
    throw new AuthError("Every human participant must consent before AI joins.", 409);
  }
  const participantId = uid("call_part");
  const invitationId = uid("call_inv");
  const { error } = await service.from("call_participants").insert({
    workspace_id: params.workspaceId,
    id: participantId,
    call_id: params.callId,
    participant_type: "ai_employee",
    employee_id: params.employeeId,
    role: params.mode === "silent_observer" ? "observer" : "participant",
    participation_mode: params.mode,
    state: "accepted",
  });
  if (error) throw error;
  const { error: invitationError } = await service.from("call_invitations").insert({
    workspace_id: params.workspaceId,
    id: invitationId,
    call_id: params.callId,
    inviter_user_id: params.userId,
    invitee_employee_id: params.employeeId,
    status: "accepted",
    expires_at: new Date(Date.now() + 40_000).toISOString(),
    accepted_at: new Date().toISOString(),
    responded_at: new Date().toISOString(),
  });
  if (invitationError) throw invitationError;
  await service
    .from("call_sessions")
    .update({ kind: "hybrid", privacy_mode: "ai_assisted", updated_at: new Date().toISOString() })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.callId);
  await insertEvent(service, {
    workspaceId: params.workspaceId,
    callId: params.callId,
    type: "call.ai_invited",
    actorType: "human",
    actorId: params.userId,
    payload: { employeeId: params.employeeId, mode: params.mode },
  });
  await upsertWorkGraphEdge(service, {
    workspaceId: params.workspaceId,
    fromObjectType: "call",
    fromObjectId: params.callId,
    relationType: "included_employee",
    toObjectType: "ai_employee",
    toObjectId: params.employeeId,
    metadata: { participationMode: params.mode },
  });
  return getCall(service, params.workspaceId, params.callId);
}

export async function setConsent(
  service: SupabaseClient,
  params: {
    workspaceId: string;
    callId: string;
    userId: string;
    consentType: "ai_listening" | "transcription" | "recording";
    granted: boolean;
    retentionPolicy?: string;
  },
) {
  const call = await getCall(service, params.workspaceId, params.callId);
  if (!call.participants.some((p) => p.userId === params.userId)) {
    throw new AuthError("Call not found.", 404);
  }
  const { error } = await service.from("call_consents").upsert(
    {
      workspace_id: params.workspaceId,
      id: uid("call_consent"),
      call_id: params.callId,
      user_id: params.userId,
      consent_type: params.consentType,
      granted: params.granted,
      retention_policy: params.retentionPolicy ?? null,
      revoked_at: params.granted ? null : new Date().toISOString(),
    },
    { onConflict: "workspace_id,call_id,user_id,consent_type" },
  );
  if (error) throw error;
  await insertEvent(service, {
    workspaceId: params.workspaceId,
    callId: params.callId,
    type: params.granted ? "call.consent_granted" : "call.consent_revoked",
    actorType: "human",
    actorId: params.userId,
    payload: { consentType: params.consentType },
  });
  return { ok: true };
}

export async function createCallArtifact(
  service: SupabaseClient,
  params: {
    workspaceId: string;
    callId: string;
    userId: string;
    type: CallArtifactType;
    title: string;
    content?: string;
    visibility?: "private" | "shared";
  },
) {
  const call = await getCall(service, params.workspaceId, params.callId);
  if (!call.participants.some((p) => p.userId === params.userId)) {
    throw new AuthError("Call not found.", 404);
  }
  const id = uid("call_art");
  let graphEntityType = "call_artifact";
  let graphEntityId = id;
  if (params.type === "task") {
    const topic = await ensureGeneralTopic(
      service,
      params.workspaceId,
      call.roomId,
    );
    const taskId = uid("task");
    const now = new Date().toISOString();
    const { error: taskError } = await service.from("tasks").insert({
      workspace_id: params.workspaceId,
      id: taskId,
      room_id: call.roomId,
      topic_id: topic.id,
      title: params.title,
      description: params.content ?? null,
      status: "open",
      priority: "medium",
      assignee_type: "human",
      assignee_id: params.userId,
      created_from: "call",
      created_by_type: "human",
      created_by_id: params.userId,
      created_at: now,
      updated_at: now,
    });
    if (taskError) throw taskError;
    graphEntityType = "task";
    graphEntityId = taskId;
  }
  const { error } = await service.from("call_artifacts").insert({
    workspace_id: params.workspaceId,
    id,
    call_id: params.callId,
    room_id: call.roomId,
    artifact_type: params.type,
    visibility: params.visibility ?? "shared",
    title: params.title,
    content: params.content ?? "",
    owner_id: params.userId,
    graph_entity_type: graphEntityType,
    graph_entity_id: graphEntityId,
  });
  if (error) throw error;
  await Promise.all([
    upsertWorkGraphEdge(service, {
      workspaceId: params.workspaceId,
      fromObjectType: "call",
      fromObjectId: params.callId,
      relationType: `produced_${params.type}`,
      toObjectType: graphEntityType,
      toObjectId: graphEntityId,
      metadata: { roomId: call.roomId, callArtifactId: id },
    }),
    upsertWorkGraphEdge(service, {
      workspaceId: params.workspaceId,
      fromObjectType: "call",
      fromObjectId: params.callId,
      relationType: "occurred_in",
      toObjectType: "room",
      toObjectId: call.roomId,
    }),
  ]);
  return { id, graphEntityType, graphEntityId };
}
