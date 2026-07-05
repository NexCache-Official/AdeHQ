import { generateSuggestionChips, parseRecruiterSuggestionChips } from "./suggestion-chips";
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

  const parsed = parseRecruiterSuggestionChips(chipConversation, input.roleKey);
  if (parsed.length >= 2) {
    return parsed;
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
  if (planned?.length) {
    return planned;
  }

  return generateSuggestionChips(
    input.readiness,
    input.brief,
    chipConversation,
    input.roleKey,
    input.canReviewBrief,
  );
}
