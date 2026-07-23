import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  bearerVoiceWorkerToken,
  createVoiceWorkerToken,
  verifyVoiceWorkerToken,
} from "@/lib/brain/voice/worker-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    let claims: ReturnType<typeof verifyVoiceWorkerToken>;
    try {
      claims = verifyVoiceWorkerToken(bearerVoiceWorkerToken(request), ["brain:turn"]);
    } catch {
      return NextResponse.json({ error: "Invalid or expired worker token." }, { status: 401 });
    }
    const service = createSupabaseSecretClient();
    const { data: call, error } = await service
      .from("calls")
      .select("id, initiator_user_id, session_state, reconnect_expires_at")
      .eq("workspace_id", claims.workspaceId)
      .eq("id", claims.callId)
      .maybeSingle();
    if (error) throw error;
    if (!call || String(call.initiator_user_id) !== claims.sub) {
      return NextResponse.json({ error: "Call not found." }, { status: 404 });
    }
    if (!["connecting", "active", "reconnecting"].includes(String(call.session_state))) {
      return NextResponse.json({ error: "Call is not active." }, { status: 409 });
    }
    if (
      call.reconnect_expires_at &&
      new Date(String(call.reconnect_expires_at)).getTime() <= Date.now()
    ) {
      return NextResponse.json({ error: "Call reconnect window expired." }, { status: 409 });
    }
    return NextResponse.json({
      token: createVoiceWorkerToken({
        userId: claims.sub,
        workspaceId: claims.workspaceId,
        callId: claims.callId,
        scopes: claims.scopes,
        ttlSeconds: 300,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker token refresh failed.";
    const status = /token|bearer|signature|scope|expired|audience/i.test(message) ? 401 : 500;
    if (status === 500) console.error("[AdeHQ voice worker token refresh]", error);
    return NextResponse.json(
      { error: status === 500 ? "Worker token refresh failed." : message },
      { status },
    );
  }
}
