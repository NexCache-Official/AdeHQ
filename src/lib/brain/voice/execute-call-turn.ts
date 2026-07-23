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
import { persistPrivateAudio } from "./persist";
import { buildCallVocabulary } from "./vocabulary";
import {
  selectSpeechRoutes,
  type SpeechRouteContext,
} from "./speech-router";
import { SpeechChunker } from "./speech-chunker";
import { settleCallComponent, upsertCallTurn } from "./call-session";
import {
  loadEmployeeVoiceProfile,
  resolveProviderVoice,
} from "./voice-profile";
import {
  bridgeClipKey,
  cacheBridgeClip,
  getCachedBridgeClip,
} from "./bridge-clips";
import {
  LIVE_CALL_BRIDGE_PHRASES,
  LIVE_CALL_WORKING_PHRASES,
  pickBridgePhrase,
} from "./bridge-phrases";
import { GroqWhisperAdapter } from "./live-adapters";
import {
  normalizeSpeechLanguage,
  transcriptLooksLikeLanguageMismatch,
} from "./transcript-language";
import { transcriptHasUsableSpeech } from "./transcript-quality";
import type {
  FinalTranscript,
  ServerCallEvent,
  SpeechContext,
} from "./live-types";
import { messageLikelyNeedsResearch } from "@/lib/ai/message-intent";
import {
  replyLeakedToolCallSyntax,
  sanitizeReplyForChat,
  StreamReplySanitizer,
} from "@/lib/ai/normalize-model-response";
import {
  isAffirmativeSearchFollowUp,
  isMetaResearchInstruction,
} from "@/lib/ai/research/resolve-research-query";
import { routeVoiceBrainTurn } from "./voice-brain-router";
import {
  appendVoiceSessionTurn,
  buildVoiceSessionSnapshot,
  getVoiceSessionSnapshot,
} from "./voice-session-snapshot";
import {
  createVoiceBrainLatencyTrace,
  logVoiceBrainLatency,
  markVoiceBrainLatency,
  voiceBrainLatencyMetadata,
} from "./voice-latency-trace";
import {
  generateVoiceLaneReply,
  persistVoiceLaneReply,
} from "./voice-lane-response";
import { scheduleVoiceAsyncEffects } from "./async-effect-compiler";
import { clearVoicePrefetchState } from "./voice-prefetch";

function isWeakVoiceReply(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (replyLeakedToolCallSyntax(trimmed)) return true;
  if (
    /^(?:got it|on it)(?:\s*[—-]\s*i'?ll follow up(?:\s+on this)?(?:\s+shortly)?)?\.?$/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  // Model deferred ("Sure — I'll check") without speaking any fact — prefer
  // the live-search grounding answer instead of leaving the caller hanging.
  const deferredOnly =
    /\b(?:i'?ll (?:look|check|pull|search|follow up)|let me (?:look|check|search|pull)|one sec|hang on|looking that up)\b/i.test(
      trimmed,
    ) || /^(?:sure|okay|ok|yeah|yep)(?:\s*[—,.!-].*)?$/i.test(trimmed);
  if (deferredOnly && trimmed.length < 140 && !/\d{2,}/.test(trimmed)) {
    return true;
  }
  return false;
}

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

async function repairMismatchedTranscript(input: {
  transcript: FinalTranscript;
  audioBytes: Buffer;
  durationSeconds: number;
  turnId: string;
  speechContext: SpeechContext;
}): Promise<FinalTranscript> {
  const expected = normalizeSpeechLanguage(input.speechContext.language);
  if (
    !transcriptLooksLikeLanguageMismatch(input.transcript.text, expected) ||
    !process.env.GROQ_API_KEY?.trim()
  ) {
    return input.transcript;
  }
  try {
    const repaired = await new GroqWhisperAdapter().transcribeUtterance(
      {
        bytes: input.audioBytes,
        mimeType: "audio/wav",
        fileName: `${input.turnId}-lang-repair.wav`,
        durationSeconds: input.durationSeconds,
      },
      { ...input.speechContext, language: expected },
    );
    if (
      repaired.text.trim() &&
      !transcriptLooksLikeLanguageMismatch(repaired.text, expected)
    ) {
      return {
        ...repaired,
        raw: {
          repairedFrom: input.transcript.raw ?? input.transcript.text,
          repairReason: "language_mismatch",
          providerRaw: repaired.raw,
        },
      };
    }
  } catch {
    // Keep the original streaming caption if repair fails.
  }
  return input.transcript;
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
    const primary = await selected.stt.transcribeUtterance(
      {
        bytes: input.audioBytes,
        mimeType: "audio/wav",
        fileName: `${input.turnId}.wav`,
        durationSeconds: input.durationSeconds,
      },
      input.speechContext,
    );
    return repairMismatchedTranscript({
      transcript: primary,
      audioBytes: input.audioBytes,
      durationSeconds: input.durationSeconds,
      turnId: input.turnId,
      speechContext: input.speechContext,
    });
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
  finalTranscript?: FinalTranscript;
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
  const speechLanguage = normalizeSpeechLanguage(
    input.routeContext.language ?? "en",
  );
  const speechContext: SpeechContext = {
    workspaceId: input.workspaceId,
    conversationId: input.roomId,
    humanUserId: input.humanUserId,
    employeeId: input.employeeId,
    language: speechLanguage,
    vocabularyPrompt: await buildCallVocabulary(input.client, {
      workspaceId: input.workspaceId,
      conversationId: input.roomId,
      humanUserId: input.humanUserId,
      employeeId: input.employeeId,
    }),
    signal: input.signal,
  };
  const stt = input.finalTranscript
    ? await repairMismatchedTranscript({
        transcript: input.finalTranscript,
        audioBytes: wav,
        durationSeconds: input.durationSeconds,
        turnId,
        speechContext,
      })
    : await transcribeWithFallback({
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
        speechContext,
      });
  const usableSpeech = transcriptHasUsableSpeech({
    text: stt.text,
    confidence: stt.confidence,
    durationSeconds: input.durationSeconds,
  });
  if (!usableSpeech) {
    // Soft-skip noise / Whisper silence hallucinations ("Thank you.") so the
    // call stays in listening without surfacing a turn failure to the human.
    await upsertCallTurn(input.client, {
      workspaceId: input.workspaceId,
      callId: input.callSessionId,
      turnId,
      sequence: input.sequence,
      idempotencyKey,
      state: "completed",
      values: {
        human_transcript: "",
        completed_at: new Date().toISOString(),
        metadata: {
          skipped: true,
          skipReason: stt.text?.trim()
            ? "stt_hallucination_or_noise"
            : "no_speech_detected",
          rawTranscript: stt.text ?? "",
          sttConfidence: stt.confidence ?? null,
          durationSeconds: input.durationSeconds,
        },
      },
    });
    await input.emit({ type: "state.changed", turn: "listening" });
    return {
      turnId,
      transcript: "",
      reply: "",
      sttWh: 0,
      brainWh: 0,
      ttsWh: 0,
    };
  }

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
    // Captions/transcription are part of the call platform envelope. Provider
    // cost is recorded, but it must not consume customer Work Hours.
    billableToWorkspace: false,
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
  await input.emit({
    type: "transcript.final",
    text: stt.text,
    source:
      stt.routeId === "route_call_stt_streaming"
        ? "streaming_stt"
        : stt.routeId.startsWith("route_call_stt_groq")
          ? "groq"
          : "fallback",
  });
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

  const warmSnapshot = getVoiceSessionSnapshot(input.callSessionId);
  const latencyTrace = createVoiceBrainLatencyTrace({
    callId: input.callSessionId,
    turnId,
    warm: Boolean(warmSnapshot),
  });
  markVoiceBrainLatency(latencyTrace, "authComplete");
  let snapshot =
    warmSnapshot ??
    (await buildVoiceSessionSnapshot({
      client: input.client,
      callId: input.callSessionId,
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      topicId: topic.id,
      humanUserId: input.humanUserId,
      employeeId: input.employeeId,
    }));
  markVoiceBrainLatency(latencyTrace, "sessionLoaded");
  appendVoiceSessionTurn(input.callSessionId, {
    speaker: "human",
    text: stt.text,
    at: new Date().toISOString(),
  });
  snapshot = getVoiceSessionSnapshot(input.callSessionId) ?? snapshot;
  clearVoicePrefetchState(input.callSessionId);

  const routeDecision = routeVoiceBrainTurn({
    message: stt.text,
    snapshot,
    triggerMessageId: humanMessage.id,
  });
  latencyTrace.route = routeDecision.route;
  markVoiceBrainLatency(latencyTrace, "routingComplete");

  // Ordinary conversation uses lean hydration; tool/research turns keep full context.
  const ctx = await loadTopicContext(
    input.client,
    input.workspaceId,
    input.roomId,
    topic.id,
    { lean: routeDecision.route !== "work_full" },
  );
  markVoiceBrainLatency(latencyTrace, "contextFetchComplete");

  const chunker = new SpeechChunker();
  const voiceProfile =
    snapshot.employeeVoiceProfile ??
    (await loadEmployeeVoiceProfile(
      input.client,
      input.workspaceId,
      input.employeeId,
    ));
  // The call-session policy is canonical for billing. A durable employee
  // preference must never silently upgrade a standard call to a paid route.
  const premiumVoiceRequested = input.routeContext.premiumVoiceRequested;
  const selected = selectSpeechRoutes({
    ...input.routeContext,
    premiumVoiceRequested,
  });
  const primaryRouteId = selected.ttsRouteId;
  const voiceProvider =
    primaryRouteId === "route_call_tts_xai"
      ? "xai"
      : primaryRouteId === "route_call_tts_fish"
        ? "fish"
        : "siliconflow";
  const voiceQuality =
    premiumVoiceRequested && input.routeContext.entitlements.premiumVoiceEnabled
      ? "premium"
      : "standard";
  const providerVoice = resolveProviderVoice(
    voiceProfile,
    voiceProvider,
    voiceQuality,
  );
  const ttsSessionPromise = selected.tts.openRealtimeSession
    ? selected.tts.openRealtimeSession({
        signal: input.signal,
        format: primaryRouteId === "route_call_tts_xai" ? "pcm" : "wav",
        voice: providerVoice,
        locale: voiceProfile.locale,
        speed: voiceProfile.pace,
      })
    : Promise.reject(new Error("Selected TTS adapter has no realtime session."));
  let ttsChain = Promise.resolve();
  let audioSequence = 0;
  let textSequence = 0;
  let ttsWh = 0;
  let ttsHadFailure = false;
  let ttsHadSuccess = false;
  let speechStateStarted = false;
  let firstTokenAt: string | null = null;
  let firstAudioAt: string | null = null;
  let usedTools = false;
  let streamedReplyText = "";
  const spokenChunks: string[] = [];

  const audioConsumer = ttsSessionPromise.then(async (session) => {
    try {
      for await (const chunk of session.chunks) {
        if (input.signal?.aborted) {
          await session.interrupt("User interrupted.");
          break;
        }
        if (!firstAudioAt) {
          firstAudioAt = new Date().toISOString();
          markVoiceBrainLatency(latencyTrace, "firstTtsByte");
        }
        await input.emit({
          type: "employee.audio.delta",
          audio: Buffer.from(chunk.bytes).toString("base64"),
          sequence: audioSequence++,
          mimeType: chunk.mimeType,
          sampleRate: chunk.sampleRate,
          channels: chunk.channels,
        });
        if (speechStateStarted) {
          await input.emit({
            type: "state.changed",
            turn: "speaking",
            activity: "speaking",
          });
          speechStateStarted = false;
        }
      }
    } catch {
      ttsHadFailure = true;
    }
  });

  const enqueueSpeech = (text: string) => {
    ttsChain = ttsChain.then(async () => {
      const normalized = text.trim();
      if (input.signal?.aborted || ttsHadFailure || !normalized) return;
      if (!speechStateStarted && !ttsHadSuccess) {
        speechStateStarted = true;
        await input.emit({
          type: "state.changed",
          turn: "synthesizing",
          activity: "speaking",
        });
      }
      const appendedSequence = textSequence++;
      const appendedText = `${normalized} `;
      try {
        const session = await ttsSessionPromise;
        await session.appendText(appendedText);
        spokenChunks.push(normalized);
        ttsHadSuccess = true;
        const usage =
          primaryRouteId === "route_call_tts_xai"
            ? { ttsCharacters: Array.from(appendedText).length }
            : { ttsUtf8Bytes: Buffer.byteLength(appendedText, "utf8") };
        const ledger = await recordBrainUsage({
          client: input.client,
          workspaceId: input.workspaceId,
          idempotencyKey: `${turnId}:tts:text:${appendedSequence}`,
          employeeId: input.employeeId,
          userId: input.humanUserId,
          roomId: input.roomId,
          sourceType: "artifact",
          routeId: primaryRouteId,
          usage,
          status: "succeeded",
          billableToWorkspace: true,
          capability: "text_to_speech",
          workType: "call_tts",
          runtimeMode: "voice_call",
          metadata: {
            callId: input.callSessionId,
            turnId,
            textCharacters: Array.from(appendedText).length,
            appendedSequence,
            voiceTier: voiceQuality,
          },
        });
        ttsWh += ledger?.workHoursCharged ?? 0;
        await input.emit({ type: "usage.estimate", wh: sttWh + ttsWh });
      } catch (error) {
        ttsHadFailure = true;
        const failedUsage =
          primaryRouteId === "route_call_tts_xai"
            ? { ttsCharacters: Array.from(appendedText).length }
            : { ttsUtf8Bytes: Buffer.byteLength(appendedText, "utf8") };
        const failedLedger = await recordBrainUsage({
          client: input.client,
          workspaceId: input.workspaceId,
          idempotencyKey: `${turnId}:tts:failed:${appendedSequence}:${primaryRouteId}`,
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
            voiceTier: voiceQuality,
          },
        });
        ttsWh += failedLedger?.workHoursCharged ?? 0;
        await input.emit({
          type: "error",
          code: "tts_failed",
          message: "Voice playback is unavailable. The answer remains in the transcript.",
          recoverable: true,
        });
      }
    });
  };

  // Immediate spoken bridge only on the full work path (research/tools).
  // local_instant / voice_fast should start the real answer immediately.
  const needsBridge =
    routeDecision.route === "work_full" &&
    (messageLikelyNeedsResearch(stt.text) ||
      isMetaResearchInstruction(stt.text) ||
      isAffirmativeSearchFollowUp(stt.text, ctx.room.messages, humanMessage.id));
  let bridgeSpoken = false;
  let workingBridgeSpoken = false;
  const speakBridgePhrase = (phrase: string, kind: "bridge" | "working") => {
    const cacheKey = bridgeClipKey({
      routeId: primaryRouteId,
      voice: providerVoice ?? voiceProfile.voiceIdentityKey,
      locale: voiceProfile.locale,
      pace: voiceProfile.pace,
      text: phrase,
    });
    ttsChain = ttsChain
      .then(async () => {
        let clip = getCachedBridgeClip(cacheKey);
        if (!clip) {
          const generated = await selected.tts.synthesize({
            text: phrase,
            voice: providerVoice,
            locale: voiceProfile.locale,
            speed: voiceProfile.pace,
            format: "mp3",
            signal: input.signal,
          });
          clip = {
            bytes: generated.bytes,
            mimeType: generated.mimeType,
            routeId: generated.routeId,
          };
          cacheBridgeClip(cacheKey, clip);
          await recordBrainUsage({
            client: input.client,
            workspaceId: input.workspaceId,
            idempotencyKey: `${turnId}:tts:${kind}:${primaryRouteId}:${phrase.slice(0, 24)}`,
            employeeId: input.employeeId,
            userId: input.humanUserId,
            roomId: input.roomId,
            sourceType: "artifact",
            routeId: generated.routeId,
            usage:
              generated.routeId === "route_call_tts_xai"
                ? { ttsCharacters: generated.characters }
                : { ttsUtf8Bytes: generated.utf8Bytes },
            status: "succeeded",
            billableToWorkspace: false,
            capability: "text_to_speech",
            workType: "call_tts_bridge",
            runtimeMode: "voice_call",
            metadata: {
              callId: input.callSessionId,
              turnId,
              voiceIdentityKey: voiceProfile.voiceIdentityKey,
              cacheMiss: true,
              treatment: "included_allowance",
              allowanceBucket: "tts_starter",
              bridgeKind: kind,
            },
          });
        }
        if (!firstAudioAt) {
          firstAudioAt = new Date().toISOString();
          markVoiceBrainLatency(latencyTrace, "firstTtsByte");
        }
        await input.emit({
          type: "state.changed",
          turn: "speaking",
          activity: "speaking",
        });
        await input.emit({
          type: "employee.audio.delta",
          audio: clip.bytes.toString("base64"),
          sequence: audioSequence++,
          mimeType: clip.mimeType,
        });
      })
      .catch(() => undefined);
  };
  if (needsBridge) {
    bridgeSpoken = true;
    speakBridgePhrase(
      pickBridgePhrase(turnId, LIVE_CALL_BRIDGE_PHRASES),
      "bridge",
    );
  }

  const streamSanitizer = new StreamReplySanitizer();
  const chunkTimeout = setInterval(() => {
    for (const chunk of chunker.flushIfTimedOut()) enqueueSpeech(chunk);
  }, Math.max(40, Math.floor(chunker.maximumWaitMs / 4)));
  let response: Awaited<ReturnType<typeof processEmployeeResponse>> | null = null;
  let laneFinalReply: string | null = null;
  const pushSpeakableDelta = (delta: string) => {
    if (!delta) return;
    if (!firstTokenAt) firstTokenAt = new Date().toISOString();
    if (!latencyTrace.firstSpeakablePhraseAt && delta.trim()) {
      markVoiceBrainLatency(latencyTrace, "firstSpeakablePhrase");
    }
    streamedReplyText += delta;
    for (const chunk of chunker.push(delta)) enqueueSpeech(chunk);
    void input.emit({ type: "employee.text.delta", text: delta });
  };

  try {
    if (
      routeDecision.route === "local_instant" ||
      routeDecision.route === "voice_fast"
    ) {
      const lane = await generateVoiceLaneReply({
        decision: routeDecision,
        snapshot,
        userMessage: stt.text,
        seed: turnId,
        abortSignal: input.signal,
        trace: latencyTrace,
        onReplyDelta: pushSpeakableDelta,
      });
      laneFinalReply = lane.reply.trim();
      const employee =
        ctx.employees.find((item) => item.id === input.employeeId) ??
        ({
          id: snapshot.employeeId,
          name: snapshot.employeeName,
          role: snapshot.employeeRole,
          roleKey: "operations",
          provider: "siliconflow",
          model: lane.model ?? "local_instant",
          seniority: "senior",
          status: "working",
          instructions: "",
          communicationStyle: "",
          successCriteria: "",
          tools: [],
          permissions: {
            readMemory: true,
            writeDraftMemory: false,
            pinMemory: false,
            createTasks: false,
            assignTasks: false,
            messageEmployees: false,
            startCalls: true,
            requestApproval: false,
            approvalBeforeExternal: true,
            approvalBeforeEmails: true,
            approvalBeforeCode: true,
            approvalBeforeBilling: true,
          },
          memoryCount: 0,
          tasksCompleted: 0,
          messagesSent: 0,
          approvalsRequested: 0,
          avgResponseTime: "",
          trustScore: 0,
          accent: "#4f46e5",
          lastActiveAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        } as (typeof ctx.employees)[number]);
      await persistVoiceLaneReply({
        client: input.client,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        topicId: topic.id,
        employee,
        reply: laneFinalReply || "Okay.",
        triggerMessageId: humanMessage.id,
        callId: input.callSessionId,
        turnId,
        humanUserId: input.humanUserId,
        userMessage: stt.text,
        route: routeDecision.route,
        snapshot,
      });
    } else {
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
            if (!latencyTrace.providerRequestStartedAt) {
              markVoiceBrainLatency(latencyTrace, "providerRequestStarted");
            }
            if (!latencyTrace.providerFirstEventAt && delta) {
              markVoiceBrainLatency(latencyTrace, "providerFirstEvent");
              markVoiceBrainLatency(latencyTrace, "providerHeadersReceived");
            }
            streamedReplyText += delta;
            const safeDelta = streamSanitizer.push(delta);
            if (!safeDelta) return;
            if (!latencyTrace.providerFirstContentTokenAt && safeDelta.trim()) {
              markVoiceBrainLatency(latencyTrace, "providerFirstContentToken");
            }
            pushSpeakableDelta(safeDelta);
          },
          onActivity: (activity) => {
            if (activity === "using_tool" || activity === "searching") {
              usedTools = true;
              void input.emit({
                type: "state.changed",
                turn: "using_tools",
                activity,
              });
              if (!bridgeSpoken && !workingBridgeSpoken && !speechStateStarted) {
                workingBridgeSpoken = true;
                speakBridgePhrase(
                  pickBridgePhrase(`${turnId}:work`, LIVE_CALL_WORKING_PHRASES),
                  "working",
                );
              }
              return;
            }
            if (speechStateStarted || firstAudioAt) return;
            void input.emit({
              type: "state.changed",
              turn: "thinking",
              activity,
            });
          },
        },
      );
      appendVoiceSessionTurn(input.callSessionId, {
        speaker: "employee",
        text: response.reply,
        at: new Date().toISOString(),
      });
      scheduleVoiceAsyncEffects({
        client: input.client,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        topicId: topic.id,
        employeeId: input.employeeId,
        employeeName: response.employeeName,
        humanUserId: input.humanUserId,
        callId: input.callSessionId,
        turnId,
        userMessage: stt.text,
        employeeReply: response.reply,
        route: "work_full",
      });
    }
  } catch (error) {
    await ttsChain.catch(() => undefined);
    const session = await ttsSessionPromise.catch(() => null);
    await session?.interrupt("Brain turn failed.");
    await audioConsumer.catch(() => undefined);
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
        metadata: voiceBrainLatencyMetadata(latencyTrace),
      },
    });
    throw error;
  } finally {
    clearInterval(chunkTimeout);
  }
  const trailingSafe = streamSanitizer.finish();
  if (trailingSafe) {
    pushSpeakableDelta(trailingSafe);
  }
  for (const chunk of chunker.finish()) enqueueSpeech(chunk);
  // Prefer sanitized model prose; if the model only leaked tool XML or deferred,
  // fall back to the live-search grounding answer so the caller hears the fact.
  const modelReply = sanitizeReplyForChat(
    laneFinalReply || response?.reply || streamSanitizer.sanitizedText,
  ).trim();
  const usedGroundingFallback =
    Boolean(response) &&
    isWeakVoiceReply(modelReply) &&
    Boolean(response?.voiceGroundingAnswer?.trim());
  const finalReply = usedGroundingFallback
    ? sanitizeReplyForChat(response!.voiceGroundingAnswer!).trim()
    : modelReply;
  const spokenFromStream = Boolean(
    streamSanitizer.sanitizedText.trim() || streamedReplyText.trim(),
  );
  // Speak when the stream produced nothing usable, or when we replaced a weak
  // deferral/tool-leak with the search grounding answer.
  if (finalReply && (!spokenFromStream || usedGroundingFallback)) {
    const late = new SpeechChunker();
    for (const chunk of late.push(finalReply)) enqueueSpeech(chunk);
    for (const chunk of late.finish()) enqueueSpeech(chunk);
  }
  await ttsChain;
  const ttsSession = await ttsSessionPromise.catch(() => null);
  if (ttsSession) {
    if (input.signal?.aborted) {
      await ttsSession.interrupt("User interrupted.");
    } else {
      await ttsSession.flush();
    }
  }
  await audioConsumer.catch(() => undefined);
  await ttsSession?.close();
  await input.emit({ type: "employee.text.final", text: finalReply });
  await input.emit({ type: "employee.audio.end" });

  let brainWh = 0;
  if (response?.agentRunId) {
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
  const unspokenText = finalReply.startsWith(spokenText)
    ? finalReply.slice(spokenText.length).trim()
    : interrupted
      ? finalReply
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
    metadata: {
      agentRunId: response?.agentRunId ?? null,
      voiceRoute: routeDecision.route,
    },
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
    speaker_name: response?.employeeName ?? snapshot.employeeName,
    text: interrupted ? spokenText : finalReply,
  });
  logVoiceBrainLatency(latencyTrace);
  await upsertCallTurn(input.client, {
    workspaceId: input.workspaceId,
    callId: input.callSessionId,
    turnId,
    sequence: input.sequence,
    idempotencyKey,
    state: interrupted ? "interrupted" : "completed",
    values: {
      employee_transcript: finalReply,
      spoken_text: spokenText,
      unspoken_text: unspokenText,
      interrupted,
      interrupted_at_character: interrupted ? spokenText.length : null,
      tts_route_id: primaryRouteId,
      agent_run_id: response?.agentRunId ?? null,
      stt_wh: sttWh,
      brain_wh: brainWh,
      tts_wh: ttsWh,
      settled_wh: sttWh + brainWh + ttsWh,
      first_text_token_at: firstTokenAt,
      first_audio_at: firstAudioAt,
      completed_at: new Date().toISOString(),
      metadata: {
        used_tools: usedTools,
        voiceRoute: routeDecision.route,
        routeReason: routeDecision.reason,
        ...voiceBrainLatencyMetadata(latencyTrace),
      },
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
  return { turnId, transcript: stt.text, reply: finalReply, sttWh, brainWh, ttsWh };
}
