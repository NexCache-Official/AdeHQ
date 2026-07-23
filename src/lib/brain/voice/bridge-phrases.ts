/**
 * Short spoken fillers for live calls while search/tools run. Cached as bridge
 * clips so the first audio can start before Brain tokens arrive.
 */

export const LIVE_CALL_BRIDGE_PHRASES = [
  "Yeah — give me a sec, I'll pull that up.",
  "One sec — looking that up now.",
  "On it — searching for that.",
  "Hang on — I'll grab that for you.",
] as const;

export const LIVE_CALL_WORKING_PHRASES = [
  "Still on it — almost there.",
  "Digging a bit more.",
  "One more second.",
  "Got it forming — hang tight.",
] as const;

export const LIVE_CALL_THINKING_PHRASES = [
  "Hmm — let me think.",
  "Right — give me a beat.",
  "Okay — working through that.",
  "Yeah — one second.",
] as const;

export const LIVE_CALL_LEAD_IN_PHRASES = [
  "So — here's what I'm seeing.",
  "Alright — short version.",
  "Okay — here's the answer.",
] as const;

/** Stable pick so the same turn keeps one phrase for cache hits. */
export function pickBridgePhrase(seed: string, phrases: readonly string[]): string {
  if (phrases.length === 0) return "One sec.";
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return phrases[hash % phrases.length] ?? phrases[0]!;
}
