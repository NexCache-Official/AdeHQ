import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getCall, heartbeatLease, resolveHumanCallEntitlements } from "@/lib/calls";
import { uid } from "@/lib/utils";

const schema = z.object({
  deviceId: z.string().min(4).max(200),
  forceRelay: z.boolean().default(false),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    if (process.env.NEXT_PUBLIC_ADEHQ_P2P_CALLS_V1 !== "1") {
      throw new AuthError("Direct calls are disabled.", 404);
    }
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid direct media request.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    const participant = call.participants.find((item) => item.userId === user.id);
    const eligible =
      call.kind === "human_human" &&
      call.privacyMode === "human_private" &&
      !call.videoEnabled &&
      !call.screenShareEnabled &&
      call.participants.length === 2 &&
      call.participants.every((item) => item.participantType === "human");
    if (!participant || !eligible) {
      throw new AuthError("This call must use the SFU.", 409);
    }
    if (parsed.data.forceRelay) {
      const entitlements = await resolveHumanCallEntitlements(service, workspaceId);
      if (!entitlements.forceRelayAvailable) {
        throw new AuthError("Force relay is not available for this workspace.", 403);
      }
    }
    await heartbeatLease(service, {
      workspaceId,
      callId: params.callId,
      userId: user.id,
      deviceId: parsed.data.deviceId,
    });
    const { data: existing, error: existingError } = await service
      .from("call_media_sessions")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("participant_id", participant.id)
      .eq("topology", "p2p")
      .is("ended_at", null)
      .maybeSingle();
    if (existingError) throw existingError;
    const mediaSessionId = existing?.id ? String(existing.id) : uid("call_media");
    if (!existing) {
      const { error } = await service.from("call_media_sessions").insert({
        workspace_id: workspaceId,
        id: mediaSessionId,
        call_id: params.callId,
        participant_id: participant.id,
        topology: "p2p",
        backend: "custom_webrtc",
        relay_policy: parsed.data.forceRelay ? "force_relay" : "automatic",
      });
      if (error) throw error;
    }
    return NextResponse.json({ mediaSessionId }, { status: existing ? 200 : 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not start direct media." }, { status: 500 });
  }
}
