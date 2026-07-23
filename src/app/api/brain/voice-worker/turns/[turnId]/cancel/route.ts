import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  bearerVoiceWorkerToken,
  verifyVoiceWorkerToken,
} from "@/lib/brain/voice/worker-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { turnId: string } },
) {
  try {
    let claims: ReturnType<typeof verifyVoiceWorkerToken>;
    try {
      claims = verifyVoiceWorkerToken(bearerVoiceWorkerToken(request), ["brain:turn"]);
    } catch {
      return NextResponse.json({ error: "Invalid or expired worker token." }, { status: 401 });
    }
    const service = createSupabaseSecretClient();
    const { data: call, error: callError } = await service
      .from("calls")
      .select("id, initiator_user_id")
      .eq("workspace_id", claims.workspaceId)
      .eq("id", claims.callId)
      .maybeSingle();
    if (callError) throw callError;
    if (!call || String(call.initiator_user_id) !== claims.sub) {
      return NextResponse.json({ error: "Call not found." }, { status: 404 });
    }
    const { data, error } = await service
      .from("call_turns")
      .update({
        state: "interrupted",
        interrupted: true,
        completed_at: new Date().toISOString(),
      })
      .eq("workspace_id", claims.workspaceId)
      .eq("call_id", claims.callId)
      .eq("id", params.turnId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Worker turn not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker turn cancellation failed.";
    const status = /token|bearer|signature|scope|expired|audience/i.test(message) ? 401 : 500;
    if (status === 500) console.error("[AdeHQ voice worker cancel]", error);
    return NextResponse.json(
      { error: status === 500 ? "Worker turn cancellation failed." : message },
      { status },
    );
  }
}
