import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getCall } from "@/lib/calls";
import { uid } from "@/lib/utils";

const schema = z.object({
  kind: z.enum(["quality", "connected", "reconnected", "dropped"]),
  topology: z.enum(["sfu", "p2p"]),
  packetLoss: z.number().min(0).max(100).optional(),
  jitterMs: z.number().min(0).max(60_000).optional(),
  roundTripMs: z.number().min(0).max(60_000).optional(),
  candidateType: z.enum(["host", "srflx", "prflx", "relay", "unknown"]).optional(),
  timeToFirstAudioMs: z.number().int().min(0).max(600_000).optional(),
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
    if (!parsed.success) throw new AuthError("Invalid call telemetry.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    if (!call.participants.some((participant) => participant.userId === user.id)) {
      throw new AuthError("Call not found.", 404);
    }
    const { error } = await service.from("call_events").insert({
      workspace_id: workspaceId,
      id: uid("call_evt"),
      call_id: params.callId,
      event_type: `call.telemetry.${parsed.data.kind}`,
      actor_type: "human",
      actor_id: user.id,
      payload: parsed.data,
    });
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not save call telemetry." }, { status: 500 });
  }
}
