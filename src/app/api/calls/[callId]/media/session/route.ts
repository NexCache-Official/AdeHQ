import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  cloudflareSfuAdapter,
  getCall,
  resolveHumanCallEntitlements,
} from "@/lib/calls";
import { uid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  sessionDescription: z.object({
    type: z.literal("offer"),
    sdp: z.string().min(20),
  }),
  deviceId: z.string().min(4).max(200),
  forceRelay: z.boolean().default(false),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid media offer.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    const participant = call.participants.find((item) => item.userId === user.id);
    if (!participant || !["accepted", "joining", "joined"].includes(participant.state)) {
      throw new AuthError("Accept the call before joining media.", 403);
    }
    if (participant.deviceId && participant.deviceId !== parsed.data.deviceId) {
      throw new AuthError("This call was answered on another device.", 409);
    }
    if (parsed.data.forceRelay) {
      const entitlements = await resolveHumanCallEntitlements(service, workspaceId);
      if (!entitlements.forceRelayAvailable) {
        throw new AuthError("Force relay is not available for this workspace.", 403);
      }
    }
    const { data: existingLease, error: leaseLookupError } = await service
      .from("call_participant_leases")
      .select("call_id, lease_expires_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (leaseLookupError) throw leaseLookupError;
    if (
      existingLease &&
      String(existingLease.call_id) !== params.callId &&
      new Date(String(existingLease.lease_expires_at)).getTime() > Date.now()
    ) {
      throw new AuthError("You are already active in another call.", 409);
    }
    const { error: leaseError } = await service.from("call_participant_leases").upsert(
      {
        workspace_id: workspaceId,
        user_id: user.id,
        call_id: params.callId,
        participant_id: participant.id,
        device_id: parsed.data.deviceId,
        heartbeat_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + 45_000).toISOString(),
      },
      { onConflict: "workspace_id,user_id" },
    );
    if (leaseError) throw leaseError;
    const result = await cloudflareSfuAdapter.createSession(parsed.data.sessionDescription);
    if (!result.sessionId || !result.sessionDescription) {
      throw new Error("Cloudflare did not return a complete session.");
    }
    const now = new Date().toISOString();
    const { data: p2pSessions, error: p2pError } = await service
      .from("call_media_sessions")
      .update({ ended_at: now, transition_reason: "network_failure" })
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("topology", "p2p")
      .is("ended_at", null)
      .select("id");
    if (p2pError) throw p2pError;
    const { error: participantError } = await service
      .from("call_participants")
      .update({
        provider_session_id: result.sessionId,
        state: "joining",
        device_id: parsed.data.deviceId,
        updated_at: now,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", participant.id);
    if (participantError) throw participantError;
    const { error: mediaError } = await service.from("call_media_sessions").insert({
      workspace_id: workspaceId,
      id: uid("call_media"),
      call_id: params.callId,
      participant_id: participant.id,
      topology: "sfu",
      backend: "cloudflare_sfu",
      relay_policy: parsed.data.forceRelay ? "force_relay" : "automatic",
      provider_session_id: result.sessionId,
      transition_reason: p2pSessions?.length ? "network_failure" : null,
    });
    if (mediaError) throw mediaError;
    if (p2pSessions?.length) {
      await service.from("call_events").insert({
        workspace_id: workspaceId,
        id: uid("call_evt"),
        call_id: params.callId,
        event_type: "call.media_migrated",
        actor_type: "system",
        payload: { from: "p2p", to: "sfu", reason: "network_failure" },
      });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Cloudflare session]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create media session." },
      { status: 502 },
    );
  }
}
