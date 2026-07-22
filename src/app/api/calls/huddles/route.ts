import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getCall, resolveHumanCallEntitlements, sendIncomingCallPush } from "@/lib/calls";
import { uid } from "@/lib/utils";
import { upsertWorkGraphEdge } from "@/lib/inbox/work-graph";

export const runtime = "nodejs";

const schema = z.object({
  roomId: z.string().min(1),
  topicId: z.string().min(1).optional(),
  inviteeUserIds: z.array(z.string().uuid()).min(1).max(99),
  idempotencyKey: z.string().min(8).max(200),
  video: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid huddle request.", 400);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, parsed.data.roomId, user.id, role);
    const service = createSupabaseSecretClient();
    const entitlements = await resolveHumanCallEntitlements(service, workspaceId);
    if (!entitlements.groupCallsEnabled) {
      throw new AuthError("Group huddles are not enabled for this workspace.", 403);
    }
    const invitees = [...new Set(parsed.data.inviteeUserIds)].filter((id) => id !== user.id);
    if (invitees.length + 1 > entitlements.maxParticipants) {
      throw new AuthError("This huddle exceeds the workspace participant limit.", 422);
    }
    const { data: members, error: membersError } = await service
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId)
      .or("status.is.null,status.neq.removed")
      .in("user_id", invitees);
    if (membersError) throw membersError;
    if ((members ?? []).length !== invitees.length) {
      throw new AuthError("Every invitee must be an active workspace member.", 422);
    }
    await Promise.all(
      (members ?? []).map((member) =>
        assertCanAccessRoom(
          service,
          workspaceId,
          parsed.data.roomId,
          String(member.user_id),
          String(member.role ?? "member"),
        ),
      ),
    );
    const { data: room, error: roomError } = await service
      .from("rooms")
      .select("kind, name")
      .eq("workspace_id", workspaceId)
      .eq("id", parsed.data.roomId)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room || room.kind === "dm") throw new AuthError("Huddles require a room.", 422);
    if (parsed.data.topicId) {
      const { data: topic, error: topicError } = await service
        .from("topics")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("room_id", parsed.data.roomId)
        .eq("id", parsed.data.topicId)
        .maybeSingle();
      if (topicError) throw topicError;
      if (!topic) throw new AuthError("Topic not found in this room.", 404);
    }

    const callId = uid("call");
    const title = `${String(room.name ?? "Room")} huddle`;
    const { error: callError } = await service.from("call_sessions").insert({
      workspace_id: workspaceId,
      id: callId,
      room_id: parsed.data.roomId,
      kind: "group",
      status: "ringing",
      privacy_mode: "human_private",
      title,
      created_by: user.id,
      idempotency_key: parsed.data.idempotencyKey,
      audio_enabled: true,
      video_enabled: parsed.data.video && entitlements.videoEnabled,
      screen_share_enabled: entitlements.screenShareEnabled,
      participant_limit: entitlements.maxParticipants,
      metadata: { topicId: parsed.data.topicId ?? null },
    });
    if (callError) {
      if (callError.code === "23505") {
        const { data: existing } = await service
          .from("call_sessions")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("idempotency_key", parsed.data.idempotencyKey)
          .maybeSingle();
        if (existing) {
          return NextResponse.json({
            ...(await getCall(service, workspaceId, String(existing.id))),
            entitlements,
          });
        }
      }
      throw callError;
    }
    const participantRows = [
      {
        workspace_id: workspaceId,
        id: uid("call_part"),
        call_id: callId,
        participant_type: "human",
        user_id: user.id,
        role: "host",
        state: "accepted",
      },
      ...invitees.map((invitee) => ({
        workspace_id: workspaceId,
        id: uid("call_part"),
        call_id: callId,
        participant_type: "human",
        user_id: invitee,
        role: "participant",
        state: "ringing",
      })),
    ];
    const { error: participantError } = await service
      .from("call_participants")
      .insert(participantRows);
    if (participantError) throw participantError;
    const invitations = invitees.map((invitee) => ({
      workspace_id: workspaceId,
      id: uid("call_inv"),
      call_id: callId,
      inviter_user_id: user.id,
      invitee_user_id: invitee,
      status: "pending",
      expires_at: new Date(Date.now() + 40_000).toISOString(),
    }));
    const { error: invitationsError } = await service.from("call_invitations").insert(invitations);
    if (invitationsError) throw invitationsError;
    await service.from("call_events").insert({
      workspace_id: workspaceId,
      id: uid("call_evt"),
      call_id: callId,
      event_type: "call.ringing",
      actor_type: "human",
      actor_id: user.id,
      payload: { inviteeUserIds: invitees, topicId: parsed.data.topicId ?? null },
    });
    await upsertWorkGraphEdge(service, {
      workspaceId,
      fromObjectType: "call",
      fromObjectId: callId,
      relationType: "occurred_in",
      toObjectType: parsed.data.topicId ? "topic" : "room",
      toObjectId: parsed.data.topicId ?? parsed.data.roomId,
      metadata: { roomId: parsed.data.roomId },
    });
    await Promise.all(
      invitations.map((invitation) =>
        sendIncomingCallPush(service, {
          workspaceId,
          userId: String(invitation.invitee_user_id),
          callId,
          invitationId: invitation.id,
          title,
        }).catch(() => ({ sent: 0 })),
      ),
    );
    return NextResponse.json(
      { ...(await getCall(service, workspaceId, callId)), entitlements },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ huddles]", error);
    return NextResponse.json({ error: "Could not start huddle." }, { status: 500 });
  }
}
