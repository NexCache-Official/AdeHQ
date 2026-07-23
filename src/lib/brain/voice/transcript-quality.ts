/**
 * Guards against common streaming/batch STT hallucinations on silence or
 * ambient noise (especially Whisper-style "Thank you." / "Thanks for watching.").
 * AdeHQ owns turn commits locally, so junk finals must not become Brain turns.
 */

export type TranscriptQualityInput = {
  text: string;
  confidence?: number | null;
  durationSeconds?: number | null;
};

/** Exact (normalized) phrases Whisper often invents for silence/noise. */
const SILENCE_HALLUCINATION_PHRASES = new Set([
  "thank you",
  "thanks",
  "thanks for watching",
  "thank you for watching",
  "thanks for listening",
  "thank you for listening",
  "please subscribe",
  "subscribe",
  "bye",
  "goodbye",
  "you",
  "the end",
  "music",
  "applause",
  "silence",
  "продолжение следует",
]);

function normalizeTranscript(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}\s'.-]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^['.\s-]+|['.\s-]+$/g, "")
    .trim();
}

/** Exact classic silence-junk phrases — safe to hide from live partial captions. */
export function isSilenceHallucinationPhrase(text: string): boolean {
  const normalized = normalizeTranscript(text);
  if (!normalized) return true;
  if (SILENCE_HALLUCINATION_PHRASES.has(normalized)) return true;
  return (
    normalized.startsWith("thanks for watching") ||
    normalized.startsWith("thank you for watching") ||
    normalized.startsWith("thanks for listening") ||
    normalized.startsWith("thank you for listening") ||
    normalized.includes("продолжение следует")
  );
}

/**
 * Returns true when the transcript should be discarded instead of driving a
 * Brain turn. Short, low-confidence, or known silence-hallucination captions
 * are rejected; real short replies like "yes" / "okay" are kept unless they
 * match a known hallucination phrase on very short audio.
 */
export function isLikelySttHallucination(input: TranscriptQualityInput): boolean {
  const normalized = normalizeTranscript(input.text ?? "");
  if (!normalized) return true;

  const duration = input.durationSeconds ?? null;
  const confidence =
    typeof input.confidence === "number" && Number.isFinite(input.confidence)
      ? input.confidence
      : null;

  if (
    isSilenceHallucinationPhrase(normalized) ||
    SILENCE_HALLUCINATION_PHRASES.has(normalized)
  ) {
    // Classic Whisper junk on idle audio. Always drop watching/subscribe
    // captions. Bare "thank you" / "thanks" only survive when audio is long
    // and confidence is high — ambient spikes almost never are.
    const isBareThanks = normalized === "thank you" || normalized === "thanks";
    if (!isBareThanks) return true;
    if (duration != null && duration < 0.9) return true;
    if (confidence != null && confidence < 0.55) return true;
    if (duration != null && duration < 1.4 && (confidence == null || confidence < 0.7)) {
      return true;
    }
    return false;
  }

  // Very short noise bursts often yield 1–2 character or single-token junk.
  if (duration != null && duration < 0.45 && normalized.length <= 3) {
    return true;
  }
  if (duration != null && duration < 0.35) {
    return true;
  }
  if (confidence != null && confidence < 0.28 && (duration == null || duration < 1.2)) {
    return true;
  }

  return false;
}

export function transcriptHasUsableSpeech(input: TranscriptQualityInput): boolean {
  const normalized = normalizeTranscript(input.text ?? "");
  if (!normalized) return false;
  return !isLikelySttHallucination(input);
}
