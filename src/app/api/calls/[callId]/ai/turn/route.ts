import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { assertCanSendRoomMessage, assertEffectiveAiAccess } from "@/lib/server/room-access";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { loadRoomContext } from "@/lib/server/room-messages";
import { processEmployeeResponse } from "@/lib/server/process-employee-response";
import { executeTextToSpeech } from "@/lib/brain/voice/execute";
import { persistTtsArtifact } from "@/lib/brain/voice/persist";
import { loadWhReceipt } from "@/lib/brain/receipts/load-wh-receipt";
import {
  createCallBillingMetadata,
  decideParticipation,
  getCall,
} from "@/lib/calls";
import { uid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  employeeId: z.string().min(1),
  content: z.string().min(1).max(12_000),
  speak: z.boolean().default(false),
  privateSidecar: z.boolean().default(false),
  kind: z.enum(["request", "delegation"]).default("request"),
  stewardRequestId: z.string().min(1).max(200).optional(),
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
    if (!parsed.success) throw new AuthError("Invalid AI call turn.", 400);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    if (!call.participants.some((participant) => participant.userId === user.id)) {
      throw new AuthError("Call not found.", 404);
    }
    const ai = call.participants.find(
      (participant) => participant.employeeId === parsed.data.employeeId,
    );
    if (!ai) throw new AuthError("Invite this employee to the call first.", 422);
    if (parsed.data.speak && ai.participationMode === "silent_observer") {
      throw new AuthError("Silent observers cannot speak in the call.", 409);
    }
    const participation = await decideParticipation({
      utterance: parsed.data.content,
      mode: ai.participationMode ?? "on_request",
      candidate: {
        employeeId: parsed.data.employeeId,
        isLead: true,
      },
      explicitMentionedEmployeeIds: [parsed.data.employeeId],
    });
    await assertCanSendRoomMessage(client, workspaceId, call.roomId, user.id, role);
    await assertEffectiveAiAccess(
      client,
      workspaceId,
      call.roomId,
      user.id,
      role,
      parsed.data.employeeId,
    );
    if (parsed.data.speak) {
      const humans = call.participants.filter((participant) => participant.userId);
      const { data: consents, error: consentError } = await service
        .from("call_consents")
        .select("user_id, granted")
        .eq("workspace_id", workspaceId)
        .eq("call_id", params.callId)
        .eq("consent_type", "ai_listening")
        .eq("granted", true);
      if (consentError) throw consentError;
      const consented = new Set((consents ?? []).map((row) => String(row.user_id)));
      if (!humans.every((participant) => consented.has(participant.userId!))) {
        throw new AuthError("Every human participant must consent before AI speaks.", 409);
      }
      const { data: speaking, error: speakingError } = await service
        .from("call_ai_turns")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("call_id", params.callId)
        .eq("state", "speaking")
        .limit(1);
      if (speakingError) throw speakingError;
      if (speaking?.length) {
        throw new AuthError("Another AI employee is already speaking.", 409);
      }
    }

    const turnId = uid("call_ai_turn");
    await service.from("call_ai_turns").insert({
      workspace_id: workspaceId,
      id: turnId,
      call_id: params.callId,
      employee_id: parsed.data.employeeId,
      mode: ai.participationMode ?? "on_request",
      state: "thinking",
      transcript: parsed.data.content,
      metadata: {
        privateSidecar: parsed.data.privateSidecar,
        requestedBy: user.id,
        kind: parsed.data.kind,
        stewardRequestId: parsed.data.stewardRequestId ?? null,
        participation,
        billing: createCallBillingMetadata([]),
      },
    });
    const context = await loadRoomContext(client, workspaceId, call.roomId);
    const response = await processEmployeeResponse(
      client,
      context,
      parsed.data.employeeId,
      parsed.data.kind === "delegation"
        ? `[Live call ${params.callId}] Work on this delegated task while the humans continue talking. Return a concise finding with sources or concrete outputs when relevant: ${parsed.data.content}`
        : `[Live call ${params.callId}] ${parsed.data.content}`,
      {
        mode: "live",
        initiatedByUserId: user.id,
        persistToRoom: !parsed.data.privateSidecar,
      },
    );

    let voice:
      | { signedUrl?: string; mimeType: string; estimatedWh: number; artifactId?: string }
      | undefined;
    if (parsed.data.speak) {
      const { result } = await executeTextToSpeech({
        client,
        workspaceId,
        request: { intent: "read_aloud", text: response.reply, confirmed: true },
        userId: user.id,
        employeeId: parsed.data.employeeId,
        roomId: call.roomId,
      });
      if (result) {
        const persisted = await persistTtsArtifact(client, {
          workspaceId,
          userId: user.id,
          employeeId: parsed.data.employeeId,
          roomId: call.roomId,
          text: response.reply,
          tts: result,
        });
        voice = {
          signedUrl: persisted.signedUrl,
          artifactId: persisted.artifactId,
          mimeType: result.mimeType,
          estimatedWh: result.estimatedWh,
        };
      }
    }
    const receipt = await loadWhReceipt(client, {
      workspaceId,
      messageId: response.aiMessageId,
    }).catch(() => null);
    let textWorkHours = Number(receipt?.totalWorkHours ?? 0);
    if (!receipt && response.agentRunId) {
      const { data: ledgerRows } = await service
        .from("ai_cost_ledger_entries")
        .select("work_hours_charged")
        .eq("workspace_id", workspaceId)
        .contains("metadata", { agentRunId: response.agentRunId });
      textWorkHours = (ledgerRows ?? []).reduce(
        (total, row) => total + Number(row.work_hours_charged ?? 0),
        0,
      );
    }
    const settledWh =
      textWorkHours + Number(voice?.estimatedWh ?? 0);
    const billing = createCallBillingMetadata([
      {
        employeeId: parsed.data.employeeId,
        workHours: settledWh,
        contribution: "single_turn",
      },
    ]);
    await service
      .from("call_ai_turns")
      .update({
        state: parsed.data.speak ? "speaking" : "completed",
        response: response.reply,
        estimated_wh: settledWh,
        settled_wh: settledWh,
        completed_at: parsed.data.speak ? null : new Date().toISOString(),
        metadata: {
          privateSidecar: parsed.data.privateSidecar,
          requestedBy: user.id,
          kind: parsed.data.kind,
          aiMode: response.aiMode,
          effect: response.effect,
          voiceArtifactId: voice?.artifactId ?? null,
          agentRunId: response.agentRunId ?? null,
          aiMessageId: response.aiMessageId ?? null,
          whReceipt: receipt,
          stewardRequestId: parsed.data.stewardRequestId ?? null,
          participation,
          billing,
        },
      })
      .eq("workspace_id", workspaceId)
      .eq("id", turnId);
    let sidecarArtifactId: string | null = null;
    if (!parsed.data.privateSidecar) {
      await service.from("call_artifacts").insert({
        workspace_id: workspaceId,
        id: uid("call_art"),
        call_id: params.callId,
        room_id: call.roomId,
        artifact_type: "note",
        visibility: "shared",
        title: `${response.employeeName} call contribution`,
        content: response.reply,
        source_employee_id: parsed.data.employeeId,
        metadata: { turnId },
      });
    } else {
      sidecarArtifactId = uid("call_art");
      await service.from("call_artifacts").insert({
        workspace_id: workspaceId,
        id: sidecarArtifactId,
        call_id: params.callId,
        room_id: call.roomId,
        artifact_type: "note",
        visibility: "private",
        title:
          parsed.data.kind === "delegation"
            ? `${response.employeeName} delegated finding`
            : `${response.employeeName} private sidecar`,
        content: response.reply,
        owner_id: user.id,
        source_employee_id: parsed.data.employeeId,
        metadata: {
          turnId,
          actionState: "pending",
          kind: parsed.data.kind,
        },
      });
    }
    return NextResponse.json({
      turnId,
      employeeId: response.employeeId,
      employeeName: response.employeeName,
      reply: response.reply,
      aiMode: response.aiMode,
      voice,
      workHours: {
        estimated: settledWh,
        settled: settledWh,
        receipt,
      },
      participation,
      billing,
      sidecarArtifactId,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ hybrid call turn]", error);
    return NextResponse.json({ error: "AI employee could not respond." }, { status: 500 });
  }
}

const updateSchema = z.object({
  action: z.enum(["completed", "interrupted"]),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const turnId = request.nextUrl.searchParams.get("turnId");
    const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
    if (!turnId || !parsed.success) throw new AuthError("Invalid AI turn update.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    if (!call.participants.some((participant) => participant.userId === user.id)) {
      throw new AuthError("Call not found.", 404);
    }
    const { data, error } = await service
      .from("call_ai_turns")
      .update({
        state: parsed.data.action,
        completed_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("id", turnId)
      .eq("state", "speaking")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AuthError("AI turn is no longer speaking.", 409);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not update AI turn." }, { status: 500 });
  }
}
