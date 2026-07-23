import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordBrainUsage } from "@/lib/brain/metering";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";
import { getWorkspaceCapacity } from "@/lib/billing/usage/periods";
import {
  reserveWorkHours,
  settleReservation,
} from "@/lib/billing/commerce/reservations";
import { ensureGeneralTopic } from "@/lib/server/topic-helpers";
import {
  insertHumanMessage,
  loadTopicContext,
} from "@/lib/server/room-messages";
import { processEmployeeResponse } from "@/lib/server/process-employee-response";
import { callSiliconFlowStt } from "./adapter";
import { XaiTtsAdapter } from "./live-adapters";
import { persistPrivateAudio } from "./persist";
import { buildCallVocabulary } from "./vocabulary";
import {
  selectSpeechRoutes,
  type SpeechRouteContext,
} from "./speech-router";
import { SpeechChunker } from "./speech-chunker";
import { settleCallComponent, upsertCallTurn } from "./call-session";
import type {
  FinalTranscript,
  ServerCallEvent,
  SpeechContext,
} from "./live-types";
import { messageLikelyNeedsResearch } from "@/lib/ai/message-intent";
import {
  isAffirmativeSearchFollowUp,
  isMetaResearchInstruction,
} from "@/lib/ai/research/resolve-research-query";

type EmitCallEvent = (event: ServerCallEvent) => void | Promise<void>;

export function pcm16ToWav(
  pcm: Uint8Array,
  sampleRate = 16_000,
  channels = 1,
): Buffer {
  const header = Buffer.alloc(44);
  const dataLength = pcm.byteLength;
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

async function transcribeWithFallback(
  input: {
    client: SupabaseClient;
    workspaceId: string;
    userId: string;
    employeeId: string;
    roomId: string;
    callId: string;
    turnId: string;
    sequence: number;
    audioBytes: Buffer;
    durationSeconds: number;
    routeContext: SpeechRouteContext;
    speechContext: SpeechContext;
  },
): Promise<FinalTranscript> {
  const selected = selectSpeechRoutes(input.routeContext);
  try {
    return await selected.stt.transcribeUtterance(
      {
        bytes: input.audioBytes,
        mimeType: "audio/wav",
        fileName: `${input.turnId}.wav`,
        durationSeconds: input.durationSeconds,
      },
      input.speechContext,
    );
  } catch (error) {
    await recordBrainUsage({
      client: input.client,
      workspaceId: input.workspaceId,
      idempotencyKey: `${input.turnId}:stt:groq:1`,
      employeeId: input.employeeId,
      userId: input.userId,
      roomId: input.roomId,
      sourceType: "artifact",
      routeId: "route_call_stt_groq_turbo",
      usage: {},
      status: "failed",
      billableToWorkspace: false,
      providerCalled: true,
      capability: "speech_to_text",
      workType: "call_stt",
      runtimeMode: "voice_call",
      metadata: {
        callId: input.callId,
        turnId: input.turnId,
        outcome: "failed_unbilled",
        providerFailure: error instanceof Error ? error.message : String(error),
      },
    });
    if (process.env.ADEHQ_LIVE_STT_SILICONFLOW_FALLBACK === "0") {
      throw error;
    }
    const fallback = await callSiliconFlowStt({
      routeId: "route_stt_fast",
      audioBytes: input.audioBytes,
      fileName: `${input.turnId}.wav`,
      mimeType: "audio/wav",
    });
    return {
      text: fallback.transcript,
      language: fallback.language,
      confidence: 0.65,
      actualAudioSeconds: input.durationSeconds,
      billableAudioSeconds: input.durationSeconds,
      latencyMs: fallback.latencyMs,
      routeId: "route_stt_fast",
      raw: fallback.raw,
    };
  }
}

export async function executeEmployeeCallTurn(input: {
  client: SupabaseClient;
  workspaceId: string;
  humanUserId: string;
  employeeId: string;
  roomId: string;
  callSessionId: string;
  sequence: number;
  pcm16: Uint8Array;
  durationSeconds: number;
  routeContext: SpeechRouteContext;
  saveRecording?: boolean;
  emit: EmitCallEvent;
  signal?: AbortSignal;
}): Promise<{
  turnId: string;
  transcript: string;
  reply: string;
  sttWh: number;
  brainWh: number;
  ttsWh: number;
}> {
  const turnId = `call_turn_${randomUUID()}`;
  const idempotencyKey = `${input.callSessionId}:${input.sequence}`;
  const now = new Date().toISOString();
  await upsertCallTurn(input.client, {
    workspaceId: input.workspaceId,
    callId: input.callSessionId,
    turnId,
    sequence: input.sequence,
    idempotencyKey,
    state: "transcribing",
    values: { human_ended_at: now, human_started_at: now },
  });
  await input.emit({ type: "state.changed", turn: "transcribing" });

  const vocabularyPrompt = await buildCallVocabulary(input.client, {
    workspaceId: input.workspaceId,
    conversationId: input.roomId,
    humanUserId: input.humanUserId,
    employeeId: input.employeeId,
  });
  const wav = pcm16ToWav(input.pcm16);
  if (input.saveRecording) {
    await persistPrivateAudio({
      client: input.client,
      workspaceId: input.workspaceId,
      bytes: wav,
      mimeType: "audio/wav",
      roomId: input.roomId,
      userId: input.humanUserId,
      retentionDays:
        input.routeContext.entitlements.transcriptRetentionDays ?? 3650,
      kind: "voice_note",
    });
  }
  const stt = await transcribeWithFallback({
    client: input.client,
    workspaceId: input.workspaceId,
    userId: input.humanUserId,
    employeeId: input.employeeId,
    roomId: input.roomId,
    callId: input.callSessionId,
    turnId,
    sequence: input.sequence,
    audioBytes: wav,
    durationSeconds: input.durationSeconds,
    routeContext: input.routeContext,
    speechContext: {
      workspaceId: input.workspaceId,
      conversationId: input.roomId,
      humanUserId: input.humanUserId,
      employeeId: input.employeeId,
      vocabularyPrompt,
      signal: input.signal,
    },
  });
  if (!stt.text) throw new Error("No speech was detected.");

  const sttLedger = await recordBrainUsage({
    client: input.client,
    workspaceId: input.workspaceId,
    idempotencyKey: `${turnId}:stt:${stt.routeId}:settled`,
    employeeId: input.employeeId,
    userId: input.humanUserId,
    roomId: input.roomId,
    sourceType: "artifact",
    routeId: stt.routeId,
    usage: { audioSeconds: stt.billableAudioSeconds },
    status: "succeeded",
    billableToWorkspace: true,
    capability: "speech_to_text",
    workType: "call_stt",
    runtimeMode: "voice_call",
    metadata: {
      callId: input.callSessionId,
      turnId,
      actualAudioSeconds: stt.actualAudioSeconds,
      billableAudioSeconds: stt.billableAudioSeconds,
      latencyMs: stt.latencyMs,
    },
  });
  const sttWh = sttLedger?.workHoursCharged ?? 0;
  await settleCallComponent(input.client, {
    workspaceId: input.workspaceId,
    callId: input.callSessionId,
    turnId,
    component: "stt",
    routeId: stt.routeId,
    idempotencyKey: `${turnId}:settlement:stt`,
    estimatedWh: sttWh,
    reservedWh: sttWh,
    actualWh: sttWh,
    customerChargedWh: sttWh,
    outcome: "success",
    metadata: {
      actualAudioSeconds: stt.actualAudioSeconds,
      billableAudioSeconds: stt.billableAudioSeconds,
    },
  });
  await input.client.from("call_transcripts").insert({
    workspace_id: input.workspaceId,
    id: `${turnId}_human`,
    call_id: input.callSessionId,
    speaker_id: input.humanUserId,
    speaker_name: "You",
    text: stt.text,
  });
  await upsertCallTurn(input.client, {
    workspaceId: input.workspaceId,
    callId: input.callSessionId,
    turnId,
    sequence: input.sequence,
    idempotencyKey,
    state: "thinking",
    values: {
      human_transcript: stt.text,
      stt_route_id: stt.routeId,
      stt_wh: sttWh,
      first_transcript_at: new Date().toISOString(),
      brain_started_at: new Date().toISOString(),
    },
  });
  await input.emit({ type: "transcript.final", text: stt.text, source: stt.routeId.startsWith("route_call_stt_groq") ? "groq" : "fallback" });
  await input.emit({ type: "state.changed", turn: "thinking", activity: "thinking" });

  const capacity = await getWorkspaceCapacity(input.client, input.workspaceId);
  const reservedTurnWh = Math.min(
    input.routeContext.entitlements.maxTurnWh,
    capacity.unlimited
      ? input.routeContext.entitlements.maxTurnWh
      : Math.max(0, capacity.remaining),
  );
  if (!capacity.unlimited && reservedTurnWh <= 0) {
    throw new Error("Not enough Work Hours remaining for this call turn.");
  }
  const reservation = await reserveWorkHours(input.client, {
    workspaceId: input.workspaceId,
    brainRunId: turnId,
    estimatedWh: reservedTurnWh,
    periodRemainingWh: capacity.remaining,
    idempotencyKey: `${turnId}:call-turn`,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    unlimited: capacity.unlimited,
  });
  if (!reservation.ok) {
    throw new Error("Not enough Work Hours remaining for this call turn.");
  }
  await upsertCallTurn(input.client, {
    workspaceId: input.workspaceId,
    callId: input.callSessionId,
    turnId,
    sequence: input.sequence,
    idempotencyKey,
    state: "thinking",
    values: { reserved_wh: reservation.reservedWh },
  });

  const topic = await ensureGeneralTopic(input.client, input.workspaceId, input.roomId);
  const humanMessage = await insertHumanMessage(
    input.client,
    input.workspaceId,
    input.roomId,
    { id: input.humanUserId, name: "You" },
    stt.text,
    topic.id,
    `${turnId}_message`,
  );
  // Keep more of the live call thread than the default lean chat path so
  // short follow-ups ("yes", "google that") still resolve the prior topic.
  const ctx = await loadTopicContext(
    input.client,
    input.workspaceId,
    input.roomId,
    topic.id,
    { lean: false },
  );

  const chunker = new SpeechChunker();
  const selected = selectSpeechRoutes(input.routeContext);
  let ttsChain = Promise.resolve();
  let audioSequence = 0;
  let ttsWh = 0;
  let ttsHadFailure = false;
  let ttsHadSuccess = false;
  let firstTokenAt: string | null = null;
  let firstAudioAt: string | null = null;
  let usedTools = false;
  const spokenChunks: string[] = [];

  const enqueueSpeech = (text: string) => {
    ttsChain = ttsChain.then(async () => {
      if (input.signal?.aborted) return;
      await input.emit({ type: "state.changed", turn: "synthesizing" });
      const primaryRouteId =
        input.routeContext.premiumVoiceRequested &&
        input.routeContext.entitlements.premiumVoiceEnabled
          ? "route_call_tts_xai"
          : "route_tts_cosyvoice2";
      try {
        const session = selected.tts.openStream
          ? await selected.tts.openStream({ text, signal: input.signal })
          : null;
        if (session) {
          const sentenceAudio: Buffer[] = [];
          let sentenceMimeType = "audio/mpeg";
          for await (const chunk of session.chunks) {
            if (input.signal?.aborted) {
              await session.cancel("User interrupted.");
              break;
            }
            sentenceMimeType = chunk.mimeType;
            sentenceAudio.push(Buffer.from(chunk.bytes));
          }
          if (!input.signal?.aborted && sentenceAudio.length) {
            if (!firstAudioAt) firstAudioAt = new Date().toISOString();
            await input.emit({
              type: "employee.audio.delta",
              audio: Buffer.concat(sentenceAudio).toString("base64"),
              sequence: audioSequence++,
              mimeType: sentenceMimeType,
            });
          }
        } else {
          const result = await selected.tts.synthesize({ text, signal: input.signal });
          if (!firstAudioAt) firstAudioAt = new Date().toISOString();
          await input.emit({
            type: "employee.audio.delta",
            audio: result.bytes.toString("base64"),
            sequence: audioSequence++,
            mimeType: result.mimeType,
          });
        }
        spokenChunks.push(text);
        ttsHadSuccess = true;
        const routeId = primaryRouteId;
        const usage =
          routeId === "route_call_tts_xai"
            ? { ttsCharacters: Array.from(text).length }
            : { ttsUtf8Bytes: Buffer.byteLength(text, "utf8") };
        const ledger = await recordBrainUsage({
          client: input.client,
          workspaceId: input.workspaceId,
          idempotencyKey: `${turnId}:tts:${audioSequence}`,
          employeeId: input.employeeId,
          userId: input.humanUserId,
          roomId: input.roomId,
          sourceType: "artifact",
          routeId,
          usage,
          status: "succeeded",
          billableToWorkspace: true,
          capability: "text_to_speech",
          workType: "call_tts",
          runtimeMode: "voice_call",
          metadata: { callId: input.callSessionId, turnId, textCharacters: text.length },
        });
        ttsWh += ledger?.workHoursCharged ?? 0;
        await input.emit({ type: "usage.estimate", wh: sttWh + ttsWh });
      } catch (error) {
        ttsHadFailure = true;
        const failedUsage =
          primaryRouteId === "route_call_tts_xai"
            ? { ttsCharacters: Array.from(text).length }
            : { ttsUtf8Bytes: Buffer.byteLength(text, "utf8") };
        const failedLedger = await recordBrainUsage({
          client: input.client,
          workspaceId: input.workspaceId,
          idempotencyKey: `${turnId}:tts:failed:${audioSequence}:${primaryRouteId}`,
          employeeId: input.employeeId,
          userId: input.humanUserId,
          roomId: input.roomId,
          sourceType: "artifact",
          routeId: primaryRouteId,
          usage: failedUsage,
          status: input.signal?.aborted ? "cancelled" : "failed",
          billableToWorkspace: true,
          capability: "text_to_speech",
          workType: "call_tts",
          runtimeMode: "voice_call",
          metadata: {
            callId: input.callSessionId,
            turnId,
            outcome: input.signal?.aborted ? "cancelled" : "failed_provider_billed",
            error: error instanceof Error ? error.message : String(error),
          },
        });
        ttsWh += failedLedger?.workHoursCharged ?? 0;
        if (
          !input.signal?.aborted &&
          primaryRouteId === "route_tts_cosyvoice2" &&
          input.routeContext.entitlements.premiumVoiceEnabled &&
          process.env.XAI_API_KEY?.trim()
        ) {
          try {
            const fallback = await new XaiTtsAdapter().synthesize({
              text,
              signal: input.signal,
            });
            if (!firstAudioAt) firstAudioAt = new Date().toISOString();
            await input.emit({
              type: "employee.audio.delta",
              audio: fallback.bytes.toString("base64"),
              sequence: audioSequence++,
              mimeType: fallback.mimeType,
            });
            spokenChunks.push(text);
            ttsHadSuccess = true;
            const ledger = await recordBrainUsage({
              client: input.client,
              workspaceId: input.workspaceId,
              idempotencyKey: `${turnId}:tts:xai-fallback:${audioSequence}`,
              employeeId: input.employeeId,
              userId: input.humanUserId,
              roomId: input.roomId,
              sourceType: "artifact",
              routeId: "route_call_tts_xai",
              usage: { ttsCharacters: Array.from(text).length },
              status: "succeeded",
              billableToWorkspace: true,
              capability: "text_to_speech",
              workType: "call_tts",
              runtimeMode: "voice_call",
              metadata: {
                callId: input.callSessionId,
                turnId,
                fallbackFrom: "route_tts_cosyvoice2",
              },
            });
            ttsWh += ledger?.workHoursCharged ?? 0;
            return;
          } catch {
            // Text-only is the final fallback; the Brain turn remains successful.
          }
        }
        await input.emit({
          type: "error",
          code: "tts_failed",
          message: "Voice playback is unavailable. The answer remains in the transcript.",
          recoverable: true,
        });
      }
    });
  };

  // Immediate spoken bridge while the Brain (and any search) starts — keeps the
  // call feeling live instead of silent for several seconds before first audio.
  const needsBridge =
    messageLikelyNeedsResearch(stt.text) ||
    isMetaResearchInstruction(stt.text) ||
    isAffirmativeSearchFollowUp(stt.text, ctx.room.messages, humanMessage.id);
  if (needsBridge) {
    await input.emit({
      type: "state.changed",
      turn: "synthesizing",
      activity: "searching",
    });
    enqueueSpeech("Yeah — give me a sec, I'll pull that up.");
  }

  let response: Awaited<ReturnType<typeof processEmployeeResponse>>;
  try {
    response = await processEmployeeResponse(
      input.client,
      ctx,
      input.employeeId,
      stt.text,
      {
        triggerMessageId: humanMessage.id,
        initiatedByUserId: input.humanUserId,
        voiceCall: true,
        abortSignal: input.signal,
        onReplyDelta: (delta) => {
          if (!firstTokenAt) firstTokenAt = new Date().toISOString();
          // Prefer audio first: enqueue TTS before mirroring text to the side
          // panel so speech leads the transcript instead of trailing it.
          for (const chunk of chunker.push(delta)) enqueueSpeech(chunk);
          void input.emit({ type: "employee.text.delta", text: delta });
        },
        onActivity: (activity) => {
          if (activity === "using_tool" || activity === "searching") usedTools = true;
          void input.emit({
            type: "state.changed",
            turn: activity === "using_tool" ? "using_tools" : "thinking",
            activity,
          });
        },
      },
    );
  } catch (error) {
    await ttsChain.catch(() => undefined);
    await settleReservation(input.client, {
      reservationId: reservation.reservationId,
      workspaceId: input.workspaceId,
      settledWh: ttsWh,
    });
    await settleCallComponent(input.client, {
      workspaceId: input.workspaceId,
      callId: input.callSessionId,
      turnId,
      component: "brain",
      idempotencyKey: `${turnId}:settlement:brain`,
      estimatedWh: 0,
      reservedWh: reservation.reservedWh,
      actualWh: 0,
      customerChargedWh: 0,
      outcome: "failed_unbilled",
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
    await upsertCallTurn(input.client, {
      workspaceId: input.workspaceId,
      callId: input.callSessionId,
      turnId,
      sequence: input.sequence,
      idempotencyKey,
      state: "failed",
      values: {
        stt_wh: sttWh,
        tts_wh: ttsWh,
        settled_wh: sttWh + ttsWh,
        completed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
  for (const chunk of chunker.finish()) enqueueSpeech(chunk);
  // Structured (non-stream) Brain turns — research/tool path — never call
  // onReplyDelta, so speak the final reply here. Skip if streaming already
  // covered the same text (or a prefix) to avoid double-speaking.
  const alreadySpoken = spokenChunks.join(" ").trim();
  const finalReply = response.reply.trim();
  const streamedPrefix = finalReply.slice(0, Math.min(40, finalReply.length));
  if (finalReply && !(streamedPrefix && alreadySpoken.includes(streamedPrefix))) {
    const late = new SpeechChunker();
    for (const chunk of late.push(finalReply)) enqueueSpeech(chunk);
    for (const chunk of late.finish()) enqueueSpeech(chunk);
  }
  await ttsChain;
  await input.emit({ type: "employee.text.final", text: response.reply });
  await input.emit({ type: "employee.audio.end" });

  let brainWh = 0;
  if (response.agentRunId) {
    const { data: usageRows } = await input.client
      .from("ai_usage_events")
      .select("actual_cost_usd, estimated_cost_usd")
      .eq("workspace_id", input.workspaceId)
      .eq("agent_run_id", response.agentRunId);
    const cost = (usageRows ?? []).reduce(
      (sum, row) =>
        sum + Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0),
      0,
    );
    brainWh = workHoursFromCost(cost);
  }
  const interrupted = Boolean(input.signal?.aborted);
  const spokenText = spokenChunks.join(" ").trim();
  const unspokenText = response.reply.startsWith(spokenText)
    ? response.reply.slice(spokenText.length).trim()
    : interrupted
      ? response.reply
      : "";
  await settleCallComponent(input.client, {
    workspaceId: input.workspaceId,
    callId: input.callSessionId,
    turnId,
    component: "brain",
    idempotencyKey: `${turnId}:settlement:brain`,
    estimatedWh: brainWh,
    reservedWh: input.routeContext.entitlements.maxTurnWh,
    actualWh: brainWh,
    customerChargedWh: brainWh,
    outcome: interrupted ? "cancelled" : "success",
    metadata: { agentRunId: response.agentRunId ?? null },
  });
  await settleReservation(input.client, {
    reservationId: reservation.reservationId,
    workspaceId: input.workspaceId,
    settledWh: Math.min(reservation.reservedWh, brainWh + ttsWh),
  });
  await settleCallComponent(input.client, {
    workspaceId: input.workspaceId,
    callId: input.callSessionId,
    turnId,
    component: "tts",
    idempotencyKey: `${turnId}:settlement:tts`,
    estimatedWh: ttsWh,
    reservedWh: ttsWh,
    actualWh: ttsWh,
    customerChargedWh: ttsWh,
    outcome: interrupted
      ? ttsHadSuccess
        ? "partial"
        : "cancelled"
      : ttsHadFailure
        ? ttsHadSuccess
          ? "partial"
          : "failed_provider_billed"
        : "success",
  });
  await input.client.from("call_transcripts").insert({
    workspace_id: input.workspaceId,
    id: `${turnId}_employee`,
    call_id: input.callSessionId,
    speaker_id: input.employeeId,
    speaker_name: response.employeeName,
    text: interrupted ? spokenText : response.reply,
  });
  await upsertCallTurn(input.client, {
    workspaceId: input.workspaceId,
    callId: input.callSessionId,
    turnId,
    sequence: input.sequence,
    idempotencyKey,
    state: interrupted ? "interrupted" : "completed",
    values: {
      employee_transcript: response.reply,
      spoken_text: spokenText,
      unspoken_text: unspokenText,
      interrupted,
      interrupted_at_character: interrupted ? spokenText.length : null,
      tts_route_id:
        input.routeContext.premiumVoiceRequested &&
        input.routeContext.entitlements.premiumVoiceEnabled
          ? "route_call_tts_xai"
          : "route_tts_cosyvoice2",
      agent_run_id: response.agentRunId ?? null,
      stt_wh: sttWh,
      brain_wh: brainWh,
      tts_wh: ttsWh,
      settled_wh: sttWh + brainWh + ttsWh,
      first_text_token_at: firstTokenAt,
      first_audio_at: firstAudioAt,
      completed_at: new Date().toISOString(),
      metadata: { used_tools: usedTools },
    },
  });
  const { data: settledTurns } = await input.client
    .from("call_turns")
    .select("settled_wh")
    .eq("workspace_id", input.workspaceId)
    .eq("call_id", input.callSessionId);
  const callSettledWh = (settledTurns ?? []).reduce(
    (sum, turn) => sum + Number(turn.settled_wh ?? 0),
    0,
  );
  const { error: callUsageUpdateError } = await input.client
    .from("calls")
    .update({
      estimated_wh: callSettledWh,
      settled_wh: callSettledWh,
      last_activity_at: new Date().toISOString(),
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.callSessionId);
  if (callUsageUpdateError) throw callUsageUpdateError;
  await input.emit({
    type: "usage.settled",
    components: { sttWh, brainWh, ttsWh },
  });
  await input.emit({
    type: "state.changed",
    turn: interrupted ? "interrupted" : "completed",
    activity: "waiting",
  });
  return { turnId, transcript: stt.text, reply: response.reply, sttWh, brainWh, ttsWh };
}
