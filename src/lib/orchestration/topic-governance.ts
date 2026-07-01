import type { OrchestratorInput, TopicStewardSuggestion } from "./types";

/** Same title in same room — suppress repeat suggestions. */
export const TOPIC_SUGGESTION_TITLE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type TopicSuggestionGovernanceContext = {
  dismissedTitles: Array<{ title: string; dismissedAt: string }>;
  recentSuggestedTitles: Array<{ title: string; suggestedAt: string }>;
  dismissedTriggerMessageIds: string[];
};

export function normalizeTopicTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function filterTopicSuggestionsByGovernance(
  suggestions: TopicStewardSuggestion[],
  ctx: TopicSuggestionGovernanceContext,
  input: Pick<OrchestratorInput, "messageId">,
): TopicStewardSuggestion[] {
  if (ctx.dismissedTriggerMessageIds.includes(input.messageId)) return [];

  return suggestions.filter((suggestion) => {
    const title =
      suggestion.type === "move_to_existing_topic"
        ? suggestion.topicTitle
        : suggestion.title;
    const norm = normalizeTopicTitle(title);

    const dismissedSimilar = ctx.dismissedTitles.some(
      (entry) =>
        normalizeTopicTitle(entry.title) === norm &&
        Date.now() - +new Date(entry.dismissedAt) < TOPIC_SUGGESTION_TITLE_COOLDOWN_MS,
    );
    if (dismissedSimilar) return false;

    const recentSame = ctx.recentSuggestedTitles.some(
      (entry) =>
        normalizeTopicTitle(entry.title) === norm &&
        Date.now() - +new Date(entry.suggestedAt) < TOPIC_SUGGESTION_TITLE_COOLDOWN_MS,
    );
    if (recentSame) return false;

    return true;
  });
}
