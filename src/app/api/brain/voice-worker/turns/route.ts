import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { loadRoomContext } from "@/lib/server/room-messages";
import { processEmployeeResponse } from "@/lib/server/process-employee-response";
import { upsertCallTurn } from "@/lib/brain/voice/call-session";
import {
  bearerVoiceWorkerToken,
  verifyVoiceWorkerToken,
} from "@/lib/brain/voice/worker-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  callId: z.string().min(1),
  workspaceId: z.string().min(1),
  transcript: z
    .array(
      z.object({
        text: z.string().min(1).max(12_000),
        isFinal: z.boolean(),
        confidence: z.number().min(0).max(1).optional(),
        language: z.string().max(30).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(request: NextRequest) {
  let turnId: string | undefined;
  let claims: ReturnType<typeof verifyVoiceWorkerToken> | undefined;
  try {
    try {
      claims = verifyVoiceWorkerToken(bearerVoiceWorkerToken(request), ["brain:turn"]);
    } catch {
      return NextResponse.json({ error: "Invalid or expired worker token." }, { status: 401 });
    }
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid worker turn request." }, { status: 400 });
    }
    if (
      parsed.data.callId !== claims.callId ||
      parsed.data.workspaceId !== claims.workspaceId
    ) {
      return NextResponse.json({ error: "Worker token identity mismatch." }, { status: 403 });
    }
    const service = createSupabaseSecretClient();
    const { data: call, error } = await service
      .from("calls")
      .select(
        "id, workspace_id, room_id, initiator_user_id, primary_employee_id, session_state, reconnect_expires_at",
      )
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
    const text = parsed.data.transcript
      .filter((item) => item.isFinal)
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!text) {
      return NextResponse.json({ error: "A final transcript is required." }, { status: 400 });
    }

    turnId = `call_turn_${randomUUID()}`;
    const sequence = Date.now();
    await upsertCallTurn(service, {
      workspaceId: claims.workspaceId,
      callId: claims.callId,
      turnId,
      sequence,
      idempotencyKey: `${claims.callId}:worker:${turnId}`,
      state: "thinking",
      values: {
        human_transcript: text,
        human_started_at: new Date().toISOString(),
        human_ended_at: new Date().toISOString(),
        first_transcript_at: new Date().toISOString(),
        brain_started_at: new Date().toISOString(),
        metadata: { transport: "cloudflare_worker", workerNonce: claims.nonce },
      },
    });
    await service.from("call_transcripts").insert({
      workspace_id: claims.workspaceId,
      id: `${turnId}_human`,
      call_id: claims.callId,
      speaker_id: claims.sub,
      speaker_name: "You",
      text,
    });
    const context = await loadRoomContext(service, claims.workspaceId, String(call.room_id));
    const response = await processEmployeeResponse(
      service,
      context,
      String(call.primary_employee_id),
      text,
      {
        mode: "live",
        initiatedByUserId: claims.sub,
        voiceCall: true,
        persistToRoom: true,
        abortSignal: request.signal,
      },
    );
    await service.from("call_transcripts").insert({
      workspace_id: claims.workspaceId,
      id: `${turnId}_employee`,
      call_id: claims.callId,
      speaker_id: String(call.primary_employee_id),
      speaker_name: response.employeeName,
      text: response.reply,
    });
    await upsertCallTurn(service, {
      workspaceId: claims.workspaceId,
      callId: claims.callId,
      turnId,
      sequence,
      idempotencyKey: `${claims.callId}:worker:${turnId}`,
      state: "completed",
      values: {
        employee_transcript: response.reply,
        agent_run_id: response.agentRunId ?? null,
        completed_at: new Date().toISOString(),
        metadata: {
          transport: "cloudflare_worker",
          workerNonce: claims.nonce,
          aiMessageId: response.aiMessageId ?? null,
        },
      },
    });
    return NextResponse.json({
      turnId,
      text: response.reply,
    });
  } catch (error) {
    if (turnId && claims) {
      const service = createSupabaseSecretClient();
      try {
        await service
          .from("call_turns")
          .update({
            state: request.signal.aborted ? "interrupted" : "failed",
            completed_at: new Date().toISOString(),
          })
          .eq("workspace_id", claims.workspaceId)
          .eq("call_id", claims.callId)
          .eq("id", turnId);
      } catch {
        // Preserve the original turn failure.
      }
    }
    const message = error instanceof Error ? error.message : "Worker turn failed.";
    const status = /token|bearer|signature|scope|expired|audience/i.test(message) ? 401 : 500;
    if (status === 500) console.error("[AdeHQ voice worker turn]", error);
    return NextResponse.json(
      { error: status === 500 ? "Worker Brain turn failed." : message },
      { status },
    );
  }
}
