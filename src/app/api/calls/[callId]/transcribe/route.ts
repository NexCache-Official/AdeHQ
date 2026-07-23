import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { executeSpeechToText } from "@/lib/brain/voice/execute";
import { loadRoomContext } from "@/lib/server/room-messages";
import { processEmployeeResponse } from "@/lib/server/process-employee-response";
import { getCall } from "@/lib/calls";
import { uid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    if (!call.participants.some((participant) => participant.userId === user.id)) {
      throw new AuthError("Call not found.", 404);
    }
    const humans = call.participants.filter((participant) => participant.userId);
    const { data: consents, error: consentError } = await service
      .from("call_consents")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("consent_type", "transcription")
      .eq("granted", true);
    if (consentError) throw consentError;
    const consented = new Set((consents ?? []).map((row) => String(row.user_id)));
    if (!humans.every((participant) => consented.has(participant.userId!))) {
      throw new AuthError("Every human participant must consent to transcription.", 409);
    }
    const observers = call.participants.filter(
      (participant) =>
        participant.participantType === "ai_employee" &&
        participant.participationMode === "silent_observer" &&
        participant.employeeId,
    );
    if (observers.length) {
      const { data: aiConsents, error: aiConsentError } = await service
        .from("call_consents")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("call_id", params.callId)
        .eq("consent_type", "ai_listening")
        .eq("granted", true);
      if (aiConsentError) throw aiConsentError;
      const aiConsented = new Set((aiConsents ?? []).map((row) => String(row.user_id)));
      if (!humans.every((participant) => aiConsented.has(participant.userId!))) {
        throw new AuthError("Every human participant must consent before AI observes.", 409);
      }
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AuthError("Audio chunk required.", 400);
    const durationSeconds = Math.min(30, Math.max(1, Number(form.get("durationSeconds") ?? 15)));
    const { policy, result } = await executeSpeechToText({
      client,
      workspaceId,
      request: {
        intent: "voice_note",
        audioBytes: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "audio/webm",
        fileName: file.name,
        durationSecondsHint: durationSeconds,
        confirmed: true,
      },
      userId: user.id,
      roomId: call.roomId,
    });
    if (!result) {
      return NextResponse.json({ error: policy.reason || "Transcription failed.", policy }, { status: 422 });
    }
    const transcript = result.transcript.trim();
    if (transcript) {
      await service.from("call_artifacts").insert({
        workspace_id: workspaceId,
        id: uid("call_art"),
        call_id: params.callId,
        room_id: call.roomId,
        artifact_type: "note",
        visibility: "shared",
        title: "Live transcript",
        content: transcript,
        owner_id: user.id,
        metadata: {
          source: "live_transcription",
          estimatedWh: result.estimatedWh,
          language: result.language,
          stewardListening: {
            sharedSttStreamCount: 1,
            perAiListeningStreams: 0,
          },
        },
      });
      if (observers.length) {
        const context = await loadRoomContext(client, workspaceId, call.roomId);
        await Promise.all(
          observers.map(async (observer) => {
            const turnId = uid("call_ai_turn");
            try {
              const response = await processEmployeeResponse(
                client,
                context,
                observer.employeeId!,
                [
                  `You are a silent observer in live call ${params.callId}.`,
                  "Return one concise private note only when this segment contains a decision, task, risk, contradiction, or unresolved question.",
                  `Transcript segment: ${transcript}`,
                ].join("\n"),
                {
                  mode: "live",
                  initiatedByUserId: user.id,
                  persistToRoom: false,
                },
              );
              let settledWh = 0;
              if (response.agentRunId) {
                const { data: ledgerRows } = await service
                  .from("ai_cost_ledger_entries")
                  .select("work_hours_charged")
                  .eq("workspace_id", workspaceId)
                  .contains("metadata", { agentRunId: response.agentRunId });
                settledWh = (ledgerRows ?? []).reduce(
                  (total, row) => total + Number(row.work_hours_charged ?? 0),
                  0,
                );
              }
              await service.from("call_ai_turns").insert({
                workspace_id: workspaceId,
                id: turnId,
                call_id: params.callId,
                employee_id: observer.employeeId,
                mode: "silent_observer",
                state: "completed",
                transcript,
                response: response.reply,
                estimated_wh: settledWh,
                settled_wh: settledWh,
                completed_at: new Date().toISOString(),
                metadata: {
                  privateSidecar: true,
                  observer: true,
                  agentRunId: response.agentRunId ?? null,
                  stewardListening: {
                    sharedSttStreamCount: 1,
                    perAiListeningStreams: 0,
                  },
                },
              });
              await service.from("call_artifacts").insert({
                workspace_id: workspaceId,
                id: uid("call_art"),
                call_id: params.callId,
                room_id: call.roomId,
                artifact_type: "note",
                visibility: "private",
                title: "Silent observer note",
                content: response.reply,
                owner_id: call.createdBy ?? user.id,
                source_employee_id: observer.employeeId,
                metadata: { turnId, settledWh },
              });
            } catch (observerError) {
              console.warn("[AdeHQ call observer]", observerError);
            }
          }),
        );
      }
    }
    return NextResponse.json({
      transcript,
      estimatedWh: result.estimatedWh,
      language: result.language,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ hybrid transcription]", error);
    return NextResponse.json({ error: "Live transcription failed." }, { status: 500 });
  }
}
