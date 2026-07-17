import type {
  SttIntent,
  SttRouteId,
  TtsIntent,
  TtsRouteId,
} from "./types";
import { STT_INTENT_LABEL, TTS_INTENT_LABEL } from "./types";

/** Approximate WH for UX estimates (actual from snapshot after call). */
export const TTS_INTENT_WH_PER_1K_BYTES: Record<TtsIntent, number> = {
  read_aloud: 0.715, // $0.00715 / 1K → WH
  narration: 0.715,
  premium_voiceover: 1.5,
};

export const STT_INTENT_WH_PER_MINUTE: Record<SttIntent, number> = {
  voice_note: 0.36, // $0.00006/s * 60 / 0.01
  accurate: 0.72,
  meeting: 0.9,
};

export function routeIdForTtsIntent(intent: TtsIntent): TtsRouteId {
  switch (intent) {
    case "narration":
      return "route_tts_indextts2";
    case "premium_voiceover":
      return "route_tts_fish_speech";
    default:
      return "route_tts_cosyvoice2";
  }
}

export function routeIdForSttIntent(intent: SttIntent): SttRouteId {
  switch (intent) {
    case "accurate":
      return "route_stt_accurate";
    case "meeting":
      return "route_stt_diarized";
    default:
      return "route_stt_fast";
  }
}

/**
 * Escalate voice-note → accurate when quality signals are weak.
 * Benchmark gate: accents, noise, tech terms, multi-speaker.
 */
export function selectSttRoute(input: {
  intent: SttIntent;
  durationSeconds: number;
  requireDiarization?: boolean;
  /** Prior confidence 0–1 from a fast pass, if any. */
  priorConfidence?: number;
  noisyHint?: boolean;
  technicalHint?: boolean;
}): SttRouteId {
  if (input.requireDiarization || input.intent === "meeting") {
    return "route_stt_diarized";
  }
  if (input.intent === "accurate") return "route_stt_accurate";
  if (input.durationSeconds > 180) return "route_stt_accurate";
  if (input.noisyHint || input.technicalHint) return "route_stt_accurate";
  if (input.priorConfidence != null && input.priorConfidence < 0.55) {
    return "route_stt_accurate";
  }
  return "route_stt_fast";
}

export function estimatedWhForTts(intent: TtsIntent, utf8Bytes: number): number {
  const perK = TTS_INTENT_WH_PER_1K_BYTES[intent];
  return Number(((utf8Bytes / 1000) * perK).toFixed(3));
}

export function estimatedWhForStt(intent: SttIntent, durationSeconds: number): number {
  const perMin = STT_INTENT_WH_PER_MINUTE[intent];
  return Number(((durationSeconds / 60) * perMin).toFixed(3));
}

export function memberLabelForTts(intent: TtsIntent): string {
  return TTS_INTENT_LABEL[intent];
}

export function memberLabelForStt(intent: SttIntent): string {
  return STT_INTENT_LABEL[intent];
}

/** Heuristic: long audio should be async, not a sync chat call. */
export function shouldUseAsyncStt(durationSeconds: number): boolean {
  return durationSeconds >= 120;
}
