/**
 * PR-18.2A7 — Deterministic three-lane voice Brain router (<20 ms).
 * No model classifier on the critical path.
 */

import { messageLikelyNeedsBusinessTool, messageLikelyNeedsResearch } from "@/lib/ai/message-intent";
import { looksLikeInstantAnswer } from "@/lib/ai/intelligence/instant-answers";
import { isMetaResearchInstruction } from "@/lib/ai/research/resolve-research-query";
import type { VoiceBrainRoute } from "./voice-latency-trace";
import type { VoiceSessionSnapshot } from "./voice-session-snapshot";

export type VoiceBrainRouteDecision = {
  route: VoiceBrainRoute;
  reason: string;
  localKind?:
    | "greeting"
    | "ack"
    | "presence"
    | "repeat"
    | "stop"
    | "shorter"
    | "continue"
    | "hold"
    | "thanks";
};

const GREETING =
  /^(?:hi|hello|hey|hiya|yo)(?:\s+[a-z][\w'-]{1,24})?(?:\s*[!.,?]*)?$/i;
const HOWDY =
  /^(?:hey|hi|hello)\s+[a-z][\w'-]{1,24}[,!]?\s+(?:how(?:'s| is| are) (?:it|things|you)(?: going| doing)?|what(?:'s| is) up)\??$/i;
const HOW_ARE_YOU =
  /^(?:how(?:'s| is| are) (?:it|things|you)(?: going| doing)?|what(?:'s| is) up|you (?:good|there)\??)\s*[!?.]*$/i;
const PRESENCE =
  /^(?:are you (?:there|here)|you there|can you hear me)\??$/i;
const THANKS =
  /^(?:thanks|thank you|thx|ty|appreciate it|cheers)(?:\s+(?:so much|a lot|priya|maya))?[.!]*$/i;
const ACK =
  /^(?:ok(?:ay)?|got it|sounds good|cool|great|perfect|alright|all right|nice|makes sense)[.!]*$/i;
const HOLD =
  /^(?:give me (?:a )?(?:sec|second|minute)|one (?:sec|second|moment)|hang on|hold on|wait(?: a (?:sec|second|minute))?)\.?$/i;
const STOP =
  /^(?:stop|cancel|never ?mind|forget it|quiet|shh+|that's enough|that is enough)\.?$/i;
const REPEAT =
  /^(?:repeat(?: that)?|say that again|what did you say|come again)\??$/i;
const SHORTER =
  /^(?:make it shorter|shorter|tl;?dr|keep it short|summarize that|brief(?:ly)?)\.?$/i;
const CONTINUE =
  /^(?:continue|go on|keep going|yes(?: please)?|yeah|yep|sure|go ahead)(?:[,.]?\s*(?:continue|go on|keep going))?\.?$/i;

export function routeVoiceBrainTurn(input: {
  message: string;
  snapshot?: VoiceSessionSnapshot | null;
  recentHumanMessages?: Array<{ id?: string; content: string }>;
  triggerMessageId?: string;
}): VoiceBrainRouteDecision {
  const text = input.message.trim();
  if (!text) {
    return { route: "local_instant", reason: "empty_turn", localKind: "ack" };
  }

  if (STOP.test(text)) {
    return { route: "local_instant", reason: "stop_command", localKind: "stop" };
  }
  if (REPEAT.test(text)) {
    return { route: "local_instant", reason: "repeat_command", localKind: "repeat" };
  }
  if (SHORTER.test(text)) {
    return { route: "local_instant", reason: "shorter_command", localKind: "shorter" };
  }
  if (HOLD.test(text)) {
    return { route: "local_instant", reason: "hold_command", localKind: "hold" };
  }
  if (PRESENCE.test(text)) {
    return { route: "local_instant", reason: "presence_check", localKind: "presence" };
  }
  if (THANKS.test(text)) {
    return { route: "local_instant", reason: "thanks", localKind: "thanks" };
  }
  if (ACK.test(text)) {
    return { route: "local_instant", reason: "acknowledgement", localKind: "ack" };
  }
  if (GREETING.test(text) || HOWDY.test(text) || HOW_ARE_YOU.test(text)) {
    return { route: "local_instant", reason: "greeting", localKind: "greeting" };
  }
  if (CONTINUE.test(text)) {
    // Affirmative follow-ups after a research offer still need the work path.
    const recent = input.snapshot?.recentTurns ?? [];
    const lastEmployee = [...recent]
      .reverse()
      .find((turn) => turn.speaker === "employee")?.text;
    const employeeOfferedSearch =
      Boolean(lastEmployee) &&
      /\b(verify|look (that|it) up|search (for|the|up)|pull (?:up )?(?:the )?(?:key )?figures|want me to (search|look|pull|check)|quick summary)\b/i.test(
        lastEmployee ?? "",
      );
    if (employeeOfferedSearch || isMetaResearchInstruction(text)) {
      return { route: "work_full", reason: "affirmative_research_follow_up" };
    }
    return { route: "local_instant", reason: "continue", localKind: "continue" };
  }

  if (
    messageLikelyNeedsResearch(text) ||
    isMetaResearchInstruction(text) ||
    messageLikelyNeedsBusinessTool(text)
  ) {
    return { route: "work_full", reason: "tools_or_research_required" };
  }

  if (looksLikeInstantAnswer(text)) {
    // Deterministic fact answers stay on voice_fast so TTS still uses employee
    // voice, but we can answer without tools/schemas.
    return { route: "voice_fast", reason: "instant_fact_via_fast_brain" };
  }

  return { route: "voice_fast", reason: "ordinary_conversation" };
}
