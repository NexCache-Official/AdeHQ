import { isFastSearchQuery } from "@/lib/ai/browser-research/provider-config";
import type { RoomMessage } from "@/lib/types";

export type ResolvedResearchQuery = {
  /** Standalone search string — not a meta-instruction. */
  query: string;
  /** The user's underlying question for reply synthesis. */
  userQuestion: string;
  resolvedFrom: "user_message" | "thread" | "combined";
  wasMetaInstruction: boolean;
};

const META_RESEARCH_PATTERNS = [
  /\b(using the browser|use the browser|with the browser|in the browser)\b/i,
  /\b(look (that|it|this) up|look up (that|it|this))\b/i,
  /\b(look up|look into|search for|check the web for)\b/i,
  /\b(search for (that|it|this)|search (that|it|this))\b/i,
  /\b(find out|please find out|can you find out)\b/i,
  /\b(find(?:ing)?\s+(?:me\s+)?(?:the\s+)?(?:address|location|phone|hours|website))\b/i,
  /\b(?:what(?:'s|\s+is)|where(?:'s|\s+is))\s+(?:the\s+)?(?:address|location)\b/i,
  /\b(can you (search|look|check|browse|google|help))\b/i,
  /\b(use (google|the web|web search|live search))\b/i,
  /\b(go (search|look)|do (a )?search)\b/i,
];

const TRIVIAL_MESSAGES =
  /^(yes|no|ok|okay|thanks|thank you|sure|please|go ahead|yep|nope|got it|do it|go for it)\.?!?$/i;

const AFFIRMATIVE_ONLY =
  /^(yes|yeah|yep|sure|ok|okay|please|go ahead|do it|go for it)[,.\s!]*$/i;

const AI_OFFERED_SEARCH =
  /\b(verify|look (that|it) up|search (for|the|up)|outdated|latest (info|data|news|figures)|check (the )?web|I'?d need to (verify|confirm|check)|want me to (search|look|pull|check|summariz)|pull (?:up )?(?:the )?(?:key )?figures|quick summary)\b/i;

const MIN_SUBSTANTIVE_LENGTH = 12;

function matchesMetaResearchPattern(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return META_RESEARCH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function hasSubstantiveTopicAfterMetaPhrases(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || TRIVIAL_MESSAGES.test(trimmed)) return false;

  const stripped = trimmed
    .replace(/\b(please|can you|could you|using the browser|use the browser|look it up|find out)\b/gi, "")
    .replace(/\b(look up|look into|search for|check the web for)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length >= MIN_SUBSTANTIVE_LENGTH;
}

/** True when the message is mostly asking the assistant to search, not stating a topic. */
export function isMetaResearchInstruction(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (!matchesMetaResearchPattern(trimmed)) return false;

  // Combined message: meta phrase + substantive question in one line.
  if (isFastSearchQuery(trimmed) && trimmed.length > 48 && hasSubstantiveTopicAfterMetaPhrases(trimmed)) {
    return false;
  }

  return true;
}

/** Reject queries that are mostly meta-instructions with no searchable topic. */
export function isMostlyMetaInstruction(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (matchesMetaResearchPattern(trimmed) && !isFastSearchQuery(trimmed)) return true;
  if (TRIVIAL_MESSAGES.test(trimmed)) return true;

  const stripped = trimmed
    .replace(/\b(please|can you|could you|using the browser|use the browser|look it up|find out)\b/gi, "")
    .replace(/\b(look up|look into|search for|check the web for)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length < MIN_SUBSTANTIVE_LENGTH;
}

function isSubstantiveUserQuestion(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed || TRIVIAL_MESSAGES.test(trimmed)) return false;
  if (isMostlyMetaInstruction(trimmed)) return false;
  return trimmed.length >= MIN_SUBSTANTIVE_LENGTH;
}

function findPriorSubstantiveUserQuestion(
  messages: RoomMessage[],
  excludeMessageId?: string,
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (excludeMessageId && message.id === excludeMessageId) continue;
    if (message.senderType !== "human") continue;
    if (isSubstantiveUserQuestion(message.content)) {
      return message.content.trim();
    }
  }
  return null;
}

export type ResolveResearchQueryInput = {
  messages: RoomMessage[];
  userMessage: string;
  excludeMessageId?: string;
};

/** User confirmed a prior offer to search (e.g. "yes" after AI asked to verify). */
export function isAffirmativeSearchFollowUp(
  userMessage: string,
  messages: RoomMessage[],
  excludeMessageId?: string,
): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed) return false;
  if (!AFFIRMATIVE_ONLY.test(trimmed) && !isMetaResearchInstruction(trimmed)) return false;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (excludeMessageId && message.id === excludeMessageId) continue;
    if (message.senderType === "human") break;
    if (message.senderType === "ai" && AI_OFFERED_SEARCH.test(message.content)) {
      return true;
    }
  }
  return isMetaResearchInstruction(trimmed);
}

/**
 * Resolve a standalone web search query from thread context.
 * Meta-requests like "please find out using the browser" map to the prior user question.
 */
export function resolveResearchQuery(input: ResolveResearchQueryInput): ResolvedResearchQuery {
  const userMessage = input.userMessage.trim();
  const wasMetaInstruction = isMetaResearchInstruction(userMessage);

  if (!wasMetaInstruction && isSubstantiveUserQuestion(userMessage) && !isMostlyMetaInstruction(userMessage)) {
    return {
      query: userMessage,
      userQuestion: userMessage,
      resolvedFrom: "user_message",
      wasMetaInstruction: false,
    };
  }

  const priorQuestion = findPriorSubstantiveUserQuestion(input.messages, input.excludeMessageId);
  if (priorQuestion) {
    return {
      query: priorQuestion,
      userQuestion: priorQuestion,
      resolvedFrom: wasMetaInstruction ? "thread" : "combined",
      wasMetaInstruction,
    };
  }

  if (userMessage && !isMostlyMetaInstruction(userMessage)) {
    return {
      query: userMessage,
      userQuestion: userMessage,
      resolvedFrom: "user_message",
      wasMetaInstruction,
    };
  }

  return {
    query: userMessage || "recent news",
    userQuestion: userMessage || "recent news",
    resolvedFrom: "user_message",
    wasMetaInstruction,
  };
}
