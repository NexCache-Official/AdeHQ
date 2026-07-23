/**
 * Local instant spoken replies — no LLM. Persisted as normal employee DM text.
 */

import type { VoiceBrainRouteDecision } from "./voice-brain-router";

const GREETING_VARIANTS = [
  "I'm good — what can I help you with?",
  "Doing well — what's up?",
  "All good here. How can I help?",
  "Hey — I'm here. What do you need?",
];

const THANKS_VARIANTS = [
  "Anytime.",
  "You got it.",
  "Happy to help.",
];

const ACK_VARIANTS = ["Got it.", "Okay.", "Sounds good."];
const PRESENCE_VARIANTS = ["Yep, I'm here.", "Still with you.", "I can hear you."];
const HOLD_VARIANTS = ["Sure — take your time.", "No rush.", "I'll be here."];
const STOP_VARIANTS = ["Okay, stopping.", "Got it — I'll stop.", "Alright."];
const CONTINUE_VARIANTS = ["Okay.", "Continuing.", "Sure."];

function pickVariant(seed: string, variants: string[]): string {
  if (variants.length === 0) return "Okay.";
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return variants[hash % variants.length] ?? variants[0]!;
}

export function resolveLocalInstantReply(input: {
  decision: VoiceBrainRouteDecision;
  employeeName: string;
  seed: string;
  lastEmployeeText?: string | null;
}): string | null {
  const kind = input.decision.localKind;
  if (!kind) return null;
  const seed = `${input.seed}:${kind}:${input.employeeName}`;

  switch (kind) {
    case "greeting":
      return pickVariant(seed, GREETING_VARIANTS);
    case "thanks":
      return pickVariant(seed, THANKS_VARIANTS);
    case "ack":
      return pickVariant(seed, ACK_VARIANTS);
    case "presence":
      return pickVariant(seed, PRESENCE_VARIANTS);
    case "hold":
      return pickVariant(seed, HOLD_VARIANTS);
    case "stop":
      return pickVariant(seed, STOP_VARIANTS);
    case "continue":
      return pickVariant(seed, CONTINUE_VARIANTS);
    case "repeat": {
      const prior = input.lastEmployeeText?.trim();
      if (prior) {
        const shortened =
          prior.length > 280 ? `${prior.slice(0, 277).trim()}…` : prior;
        return shortened;
      }
      return "I didn't catch a prior answer to repeat — what should I go over?";
    }
    case "shorter": {
      const prior = input.lastEmployeeText?.trim();
      if (!prior) return "Sure — what should I shorten?";
      const sentence = prior.split(/(?<=[.!?])\s+/)[0]?.trim();
      return sentence && sentence.length >= 12
        ? sentence
        : prior.length > 160
          ? `${prior.slice(0, 157).trim()}…`
          : prior;
    }
    default:
      return null;
  }
}
