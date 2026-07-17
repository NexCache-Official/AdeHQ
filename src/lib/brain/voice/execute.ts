import type { SupabaseClient } from "@supabase/supabase-js";
import { getLiveSeedSnapshot } from "@/lib/brain/catalog";
import { costUsdFromSnapshot } from "@/lib/brain/catalog/pricing-snapshots";
import { isBrainVoiceV1Enabled } from "@/lib/brain/flags";
import { recordBrainUsage } from "@/lib/brain/metering";
import { getWorkspaceCapacity } from "@/lib/billing/usage/periods";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";
import {
  buildSegmentsFromTranscript,
  callSiliconFlowStt,
  callSiliconFlowTts,
} from "./adapter";
import {
  DEFAULT_WORKSPACE_VOICE_SETTINGS,
  evaluateSttPolicy,
  evaluateTtsPolicy,
} from "./policy";
import {
  estimatedWhForStt,
  estimatedWhForTts,
  memberLabelForStt,
  memberLabelForTts,
  routeIdForSttIntent,
  routeIdForTtsIntent,
  selectSttRoute,
  shouldUseAsyncStt,
} from "./select";
import type {
  SpeechToTextResult,
  SynthesizeRequest,
  TextToSpeechResult,
  TranscribeRequest,
  VoicePolicyDecision,
  WorkspaceVoiceSettings,
} from "./types";

export async function loadWorkspaceVoiceSettings(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceVoiceSettings> {
  const { data } = await client
    .from("workspaces")
    .select("voice_settings")
    .eq("id", workspaceId)
    .maybeSingle();
  const raw = (data?.voice_settings ?? {}) as Partial<WorkspaceVoiceSettings>;
  return { ...DEFAULT_WORKSPACE_VOICE_SETTINGS, ...raw };
}

export async function assessTtsRequest(
  client: SupabaseClient,
  workspaceId: string,
  request: SynthesizeRequest,
  opts?: { employeeVoiceEnabled?: boolean },
): Promise<VoicePolicyDecision> {
  const capacity = await getWorkspaceCapacity(client, workspaceId);
  const settings = await loadWorkspaceVoiceSettings(client, workspaceId);
  return evaluateTtsPolicy({
    intent: request.intent,
    text: request.text,
    remainingWh: capacity.unlimited ? null : capacity.remaining,
    settings,
    voiceEnabledPlatform: isBrainVoiceV1Enabled(),
    employeeVoiceEnabled: opts?.employeeVoiceEnabled,
  });
}

export async function assessSttRequest(
  client: SupabaseClient,
  workspaceId: string,
  request: TranscribeRequest,
): Promise<VoicePolicyDecision & { asyncJob: boolean }> {
  const capacity = await getWorkspaceCapacity(client, workspaceId);
  const settings = await loadWorkspaceVoiceSettings(client, workspaceId);
  const duration = Math.max(1, request.durationSecondsHint ?? 30);
  const policy = evaluateSttPolicy({
    intent: request.intent,
    durationSeconds: duration,
    remainingWh: capacity.unlimited ? null : capacity.remaining,
    settings,
    voiceEnabledPlatform: isBrainVoiceV1Enabled(),
    confirmed: request.confirmed,
  });
  return { ...policy, asyncJob: shouldUseAsyncStt(duration) };
}

export async function executeTextToSpeech(params: {
  client: SupabaseClient;
  workspaceId: string;
  request: SynthesizeRequest;
  userId?: string | null;
  employeeId?: string | null;
  roomId?: string | null;
  topicId?: string | null;
  messageId?: string | null;
  brainRunId?: string | null;
  skipPolicy?: boolean;
}): Promise<{ policy: VoicePolicyDecision; result?: TextToSpeechResult }> {
  const policy = params.skipPolicy
    ? {
        action: "proceed" as const,
        estimatedWhMin: 0,
        estimatedWhMax: 0,
        memberLabel: memberLabelForTts(params.request.intent),
        remainingWh: null,
      }
    : await assessTtsRequest(params.client, params.workspaceId, params.request);

  if (policy.action === "blocked") return { policy };
  if (policy.action === "confirm_estimate" && !params.request.confirmed) {
    return { policy };
  }

  const routeId = routeIdForTtsIntent(params.request.intent);
  const utf8Bytes = Buffer.byteLength(params.request.text, "utf8");
  const call = await callSiliconFlowTts({
    routeId,
    text: params.request.text,
    speed: params.request.speakingRate,
  });

  const snapshot = getLiveSeedSnapshot(routeId);
  const costUsd = snapshot
    ? costUsdFromSnapshot(snapshot, { ttsUtf8Bytes: utf8Bytes })
    : estimatedWhForTts(params.request.intent, utf8Bytes) * 0.01;
  const estimatedWh = workHoursFromCost(costUsd);

  await recordBrainUsage({
    client: params.client,
    workspaceId: params.workspaceId,
    idempotencyKey: `tts:${params.workspaceId}:${params.messageId ?? "adhoc"}:${routeId}:${utf8Bytes}`,
    employeeId: params.employeeId,
    userId: params.userId,
    brainRunId: params.brainRunId,
    roomId: params.roomId,
    topicId: params.topicId,
    messageId: params.messageId,
    sourceType: "artifact",
    routeId,
    usage: { ttsUtf8Bytes: utf8Bytes },
    status: "succeeded",
    billableToWorkspace: true,
    capability: "text_to_speech",
    workType: "tts",
    runtimeMode: "multimodal",
    metadata: {
      workHours: estimatedWh,
      intent: params.request.intent,
      memberLabel: memberLabelForTts(params.request.intent),
    },
  });

  return {
    policy,
    result: {
      bytes: call.bytes,
      mimeType: call.mimeType,
      utf8Bytes,
      routeId,
      memberLabel: memberLabelForTts(params.request.intent),
      estimatedWh,
      costUsd,
      latencyMs: call.latencyMs,
    },
  };
}

export async function executeSpeechToText(params: {
  client: SupabaseClient;
  workspaceId: string;
  request: TranscribeRequest;
  userId?: string | null;
  employeeId?: string | null;
  roomId?: string | null;
  topicId?: string | null;
  messageId?: string | null;
  brainRunId?: string | null;
  skipPolicy?: boolean;
}): Promise<{ policy: VoicePolicyDecision; result?: SpeechToTextResult; asyncJob?: boolean }> {
  const assessed = params.skipPolicy
    ? {
        action: "proceed" as const,
        estimatedWhMin: 0,
        estimatedWhMax: 0,
        memberLabel: memberLabelForStt(params.request.intent),
        remainingWh: null,
        asyncJob: shouldUseAsyncStt(params.request.durationSecondsHint ?? 30),
      }
    : await assessSttRequest(params.client, params.workspaceId, params.request);

  if (assessed.action === "blocked") return { policy: assessed };
  if (assessed.action === "confirm_estimate" && !params.request.confirmed) {
    return { policy: assessed, asyncJob: assessed.asyncJob };
  }

  if (!params.request.audioBytes?.length) {
    return {
      policy: {
        ...assessed,
        action: "blocked",
        reason: "No audio bytes provided for transcription.",
      },
    };
  }

  const duration = Math.max(1, params.request.durationSecondsHint ?? 30);
  const routeId = selectSttRoute({
    intent: params.request.intent,
    durationSeconds: duration,
    requireDiarization: params.request.requireDiarization,
    technicalHint: /\b(api|kubernetes|supabase|typescript)\b/i.test(
      params.request.fileName ?? "",
    ),
  });

  // Long meetings: caller should enqueue async job instead
  if (assessed.asyncJob && params.request.intent === "meeting") {
    return { policy: assessed, asyncJob: true };
  }

  const call = await callSiliconFlowStt({
    routeId,
    audioBytes: params.request.audioBytes,
    fileName: params.request.fileName,
    mimeType: params.request.mimeType,
  });

  // Optional escalate once if empty / very short vs duration
  let transcript = call.transcript;
  let usedRoute = routeId;
  let latencyMs = call.latencyMs;
  if (!transcript && routeId === "route_stt_fast") {
    const retry = await callSiliconFlowStt({
      routeId: "route_stt_accurate",
      audioBytes: params.request.audioBytes,
      fileName: params.request.fileName,
      mimeType: params.request.mimeType,
    });
    transcript = retry.transcript;
    usedRoute = "route_stt_accurate";
    latencyMs += retry.latencyMs;
  }

  const snapshot = getLiveSeedSnapshot(usedRoute);
  const costUsd = snapshot
    ? costUsdFromSnapshot(snapshot, { audioSeconds: duration })
    : estimatedWhForStt(params.request.intent, duration) * 0.01;
  const estimatedWh = workHoursFromCost(costUsd);

  const segments = buildSegmentsFromTranscript(
    transcript,
    duration,
    params.request.requireDiarization || params.request.intent === "meeting"
      ? ["Speaker A", "Speaker B"]
      : undefined,
  );

  await recordBrainUsage({
    client: params.client,
    workspaceId: params.workspaceId,
    idempotencyKey: `stt:${params.workspaceId}:${params.messageId ?? params.request.audioFileId ?? "adhoc"}:${usedRoute}:${duration}`,
    employeeId: params.employeeId,
    userId: params.userId,
    brainRunId: params.brainRunId,
    roomId: params.roomId,
    topicId: params.topicId,
    messageId: params.messageId,
    sourceType: "artifact",
    routeId: usedRoute,
    usage: { audioSeconds: duration },
    status: transcript ? "succeeded" : "failed",
    billableToWorkspace: Boolean(transcript),
    capability: "speech_to_text",
    workType: "stt",
    runtimeMode: "multimodal",
    metadata: {
      workHours: transcript ? estimatedWh : 0,
      intent: params.request.intent,
      memberLabel: memberLabelForStt(params.request.intent),
      selectedRoute: usedRoute,
      catalogRoute: routeIdForSttIntent(params.request.intent),
    },
  });

  if (!transcript) {
    return {
      policy: {
        ...assessed,
        action: "blocked",
        reason: "Transcription returned no text. Try again or upload a clearer recording.",
      },
    };
  }

  return {
    policy: assessed,
    result: {
      transcript,
      language: call.language,
      confidence: 0.75,
      durationSeconds: duration,
      segments,
      routeId: usedRoute,
      memberLabel: memberLabelForStt(params.request.intent),
      estimatedWh,
      costUsd,
      latencyMs,
    },
  };
}
