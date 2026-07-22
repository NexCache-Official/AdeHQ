import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getCall } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const call = await getCall(createSupabaseSecretClient(), workspaceId, params.callId);
    if (!call.participants.some((participant) => participant.userId === user.id)) {
      throw new AuthError("Call not found.", 404);
    }
    const secret =
      process.env.CALL_SIGNALING_SECRET?.trim() ||
      process.env.SUPABASE_SECRET_KEY?.trim();
    if (!secret) throw new AuthError("Direct-call signaling is not configured.", 503);
    const key = createHmac("sha256", secret)
      .update(`${workspaceId}:${params.callId}:p2p-signal-v1`)
      .digest("base64url");
    return NextResponse.json({ key });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not authorize call signaling." }, { status: 500 });
  }
}
