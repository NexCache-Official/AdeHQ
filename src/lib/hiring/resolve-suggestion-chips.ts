import {
  areValidUserResponseChips,
  fallbackRecruiterSuggestionChips,
  generateSuggestionChips,
  parseRecruiterSuggestionChips,
} from "./suggestion-chips";
import { planRecruiterSuggestionChips } from "./recruiter-chip-planner";
import type {
  AiEmployeeJobBrief,
  RecruiterMessage,
  RecruiterReadiness,
  RecruiterSuggestionChip,
} from "./types";

function conversationForChipGeneration(
  conversation: RecruiterMessage[],
  lastAdeMessage: string,
): RecruiterMessage[] {
  const trimmed = lastAdeMessage.trim();
  if (!trimmed) return conversation;

  const lastAdeInThread = [...conversation].reverse().find((message) => message.role === "ade")?.text ?? "";
  if (lastAdeInThread.trim() === trimmed) return conversation;

  return [...conversation, { role: "ade", text: trimmed }];
}

/**
 * Prefer local chip parsing / fallbacks before burning a second LLM call.
 * Chip planner only runs when we cannot extract at least two valid options.
 */
export async function resolveRecruiterSuggestionChips(input: {
  readiness: RecruiterReadiness;
  brief: AiEmployeeJobBrief;
  conversation: RecruiterMessage[];
  roleKey?: string | null;
  lastAdeMessage: string;
  lastUserMessage?: string;
  canReviewBrief?: boolean;
}): Promise<RecruiterSuggestionChip[]> {
  const chipConversation = conversationForChipGeneration(
    input.conversation,
    input.lastAdeMessage,
  );
  const mode =
    input.canReviewBrief || input.readiness.ready ? "ready_to_review" : "gathering";
  const lastAde = input.lastAdeMessage.trim();

  const knownLibraryRole = Boolean(input.roleKey && input.roleKey !== "custom");

  if (mode === "ready_to_review") {
    // Ready CTAs are fixed product chips — never burn a planner LLM here
    // (closing-message validation would reject them anyway).
    const generated = generateSuggestionChips(
      input.readiness,
      input.brief,
      chipConversation,
      input.roleKey,
      true,
    );
    if (generated.length >= 2) return generated;
    return fallbackRecruiterSuggestionChips({
      conversation: chipConversation,
      roleKey: input.roleKey,
      readiness: input.readiness,
      brief: input.brief,
      canReviewBrief: input.canReviewBrief,
    });
  }

  // Gathering: parse options from Maya's question first (no LLM).
  const parsed = parseRecruiterSuggestionChips(chipConversation, input.roleKey);
  if (parsed.length >= 2 && areValidUserResponseChips(parsed, lastAde)) {
    return parsed;
  }

  const fallback = fallbackRecruiterSuggestionChips({
    conversation: chipConversation,
    roleKey: input.roleKey,
    readiness: input.readiness,
    brief: input.brief,
    canReviewBrief: input.canReviewBrief,
  });
  if (fallback.length >= 2 && areValidUserResponseChips(fallback, lastAde)) {
    return fallback;
  }

  // Library roles already ship role-specific fallback chips — skip planner.
  if (knownLibraryRole) {
    return fallback.length ? fallback : parsed;
  }

  const planned = await planRecruiterSuggestionChips({
    lastAdeMessage: input.lastAdeMessage,
    roleTitle: input.brief.roleTitle,
    department: input.brief.department,
    domain: input.brief.domain,
    mission: input.brief.mission,
    businessFocus: input.brief.businessFocus,
    technicalFocus: input.brief.technicalFocus,
    lastUserMessage: input.lastUserMessage,
    recentConversation: chipConversation,
    roleKey: input.roleKey,
    mode,
  });
  if (planned?.length && areValidUserResponseChips(planned, lastAde)) {
    return planned;
  }

  return fallback.length ? fallback : parsed;
}
