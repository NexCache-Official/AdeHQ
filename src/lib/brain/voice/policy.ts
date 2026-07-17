import type { WorkspaceVoiceSettings } from "./types";
import {
  estimatedWhForStt,
  estimatedWhForTts,
  memberLabelForStt,
  memberLabelForTts,
} from "./select";
import type { SttIntent, TtsIntent, VoicePolicyDecision } from "./types";

export const DEFAULT_WORKSPACE_VOICE_SETTINGS: WorkspaceVoiceSettings = {
  voiceEnabled: true,
  premiumVoicesAllowed: false,
  maxAudioSeconds: 600,
  retentionDays: 90,
  meetingTranscriptionAllowed: true,
  diarizationAllowed: true,
};

export function evaluateTtsPolicy(input: {
  intent: TtsIntent;
  text: string;
  remainingWh: number | null;
  settings: WorkspaceVoiceSettings;
  voiceEnabledPlatform: boolean;
  employeeVoiceEnabled?: boolean;
}): VoicePolicyDecision {
  const utf8Bytes = Buffer.byteLength(input.text, "utf8");
  const estimatedWh = estimatedWhForTts(input.intent, utf8Bytes);
  const memberLabel = memberLabelForTts(input.intent);

  if (!input.voiceEnabledPlatform || !input.settings.voiceEnabled) {
    return {
      action: "blocked",
      estimatedWhMin: estimatedWh,
      estimatedWhMax: estimatedWh,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: "Voice is disabled for this workspace.",
    };
  }
  if (input.employeeVoiceEnabled === false) {
    return {
      action: "blocked",
      estimatedWhMin: estimatedWh,
      estimatedWhMax: estimatedWh,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: "This employee does not have voice enabled.",
    };
  }
  if (input.intent === "premium_voiceover" && !input.settings.premiumVoicesAllowed) {
    return {
      action: "blocked",
      estimatedWhMin: estimatedWh,
      estimatedWhMax: estimatedWh,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: "Premium voices are not enabled. Ask a workspace admin.",
    };
  }
  if (!input.text.trim()) {
    return {
      action: "blocked",
      estimatedWhMin: 0,
      estimatedWhMax: 0,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: "Nothing to read aloud.",
    };
  }
  if (input.remainingWh != null && estimatedWh > input.remainingWh) {
    return {
      action: "blocked",
      estimatedWhMin: estimatedWh,
      estimatedWhMax: estimatedWh,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: "Not enough Work Hours remaining for speech.",
    };
  }
  if (estimatedWh >= 1) {
    return {
      action: "confirm_estimate",
      estimatedWhMin: estimatedWh * 0.8,
      estimatedWhMax: estimatedWh * 1.2,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: `Estimated ${estimatedWh.toFixed(2)} Work Hours for speech.`,
    };
  }
  return {
    action: "proceed",
    estimatedWhMin: estimatedWh,
    estimatedWhMax: estimatedWh,
    memberLabel,
    remainingWh: input.remainingWh,
  };
}

export function evaluateSttPolicy(input: {
  intent: SttIntent;
  durationSeconds: number;
  remainingWh: number | null;
  settings: WorkspaceVoiceSettings;
  voiceEnabledPlatform: boolean;
  confirmed?: boolean;
}): VoicePolicyDecision {
  const estimatedWh = estimatedWhForStt(input.intent, Math.max(1, input.durationSeconds));
  const memberLabel = memberLabelForStt(input.intent);
  const maxEst = estimatedWh * 1.25;

  if (!input.voiceEnabledPlatform || !input.settings.voiceEnabled) {
    return {
      action: "blocked",
      estimatedWhMin: estimatedWh,
      estimatedWhMax: maxEst,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: "Voice is disabled for this workspace.",
    };
  }
  if (input.intent === "meeting" && !input.settings.meetingTranscriptionAllowed) {
    return {
      action: "blocked",
      estimatedWhMin: estimatedWh,
      estimatedWhMax: maxEst,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: "Meeting transcription is not allowed in this workspace.",
    };
  }
  if (input.durationSeconds > input.settings.maxAudioSeconds) {
    return {
      action: "blocked",
      estimatedWhMin: estimatedWh,
      estimatedWhMax: maxEst,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: `Audio exceeds the maximum length (${input.settings.maxAudioSeconds}s).`,
    };
  }
  if (input.remainingWh != null && estimatedWh > input.remainingWh) {
    return {
      action: "blocked",
      estimatedWhMin: estimatedWh,
      estimatedWhMax: maxEst,
      memberLabel,
      remainingWh: input.remainingWh,
      reason: "Not enough Work Hours remaining for transcription.",
    };
  }
  // Long jobs always show an estimate range before processing
  if (input.durationSeconds >= 120 && !input.confirmed) {
    return {
      action: "confirm_estimate",
      estimatedWhMin: Number((estimatedWh * 0.85).toFixed(2)),
      estimatedWhMax: Number(maxEst.toFixed(2)),
      memberLabel,
      remainingWh: input.remainingWh,
      reason: `Estimated ${estimatedWh.toFixed(2)}–${maxEst.toFixed(2)} Work Hours for this recording.`,
    };
  }
  return {
    action: "proceed",
    estimatedWhMin: estimatedWh,
    estimatedWhMax: maxEst,
    memberLabel,
    remainingWh: input.remainingWh,
  };
}
