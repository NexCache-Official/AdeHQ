import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { cloudflareSfuAdapter, getCall } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  sessionId: z.string().min(1),
  sessionDescription: z.object({
    type: z.literal("answer"),
    sdp: z.string().min(20),
  }),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid renegotiation.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const call = await getCall(createSupabaseSecretClient(), workspaceId, params.callId);
    const participant = call.participants.find((item) => item.userId === user.id);
    if (!participant || participant.providerSessionId !== parsed.data.sessionId) {
      throw new AuthError("Media session not found.", 404);
    }
    return NextResponse.json(
      await cloudflareSfuAdapter.renegotiate(
        parsed.data.sessionId,
        parsed.data.sessionDescription,
      ),
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not renegotiate media." },
      { status: 502 },
    );
  }
}
