import type { OrchestratorInput, TopicStewardSuggestion } from "./types";
import { titleRelevanceTokens } from "./topic-title";

/** Same / near-duplicate title in same room — suppress repeat suggestions. */
export const TOPIC_SUGGESTION_TITLE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type TopicSuggestionGovernanceContext = {
  dismissedTitles: Array<{ title: string; dismissedAt: string }>;
  recentSuggestedTitles: Array<{ title: string; suggestedAt: string }>;
  dismissedTriggerMessageIds: string[];
  /** Active non-General topic titles in the room (block near-duplicate creates). */
  existingTopicTitles?: string[];
};

export function normalizeTopicTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when titles are the same workstream under slightly different wording. */
export function titlesAreNearDuplicate(a: string, b: string): boolean {
  const na = normalizeTopicTitle(a);
  const nb = normalizeTopicTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  if (na.length >= 8 && nb.length >= 8 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }

  const tokensA = titleRelevanceTokens(na);
  const tokensB = titleRelevanceTokens(nb);
  if (!tokensA.length || !tokensB.length) return false;

  const setB = new Set(tokensB);
  const overlap = tokensA.filter((t) => setB.has(t)).length;
  if (!overlap) return false;

  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = overlap / union;
  if (jaccard >= 0.55) return true;

  const minLen = Math.min(tokensA.length, tokensB.length);
  return overlap >= 2 && overlap >= Math.ceil(minLen * 0.75);
}

function suggestionTitle(suggestion: TopicStewardSuggestion): string {
  return suggestion.type === "move_to_existing_topic"
    ? suggestion.topicTitle
    : suggestion.title;
}

export function filterTopicSuggestionsByGovernance(
  suggestions: TopicStewardSuggestion[],
  ctx: TopicSuggestionGovernanceContext,
  input: Pick<OrchestratorInput, "messageId">,
): TopicStewardSuggestion[] {
  if (ctx.dismissedTriggerMessageIds.includes(input.messageId)) return [];

  const existingTitles = ctx.existingTopicTitles ?? [];

  return suggestions.filter((suggestion) => {
    const title = suggestionTitle(suggestion);
    const norm = normalizeTopicTitle(title);
    if (!norm) return false;

    // Never propose creating a near-duplicate of an existing room topic.
    if (suggestion.type === "create_topic") {
      const clashesExisting = existingTitles.some((existing) =>
        titlesAreNearDuplicate(title, existing),
      );
      if (clashesExisting) return false;
    }

    const dismissedSimilar = ctx.dismissedTitles.some(
      (entry) =>
        titlesAreNearDuplicate(entry.title, title) &&
        Date.now() - +new Date(entry.dismissedAt) < TOPIC_SUGGESTION_TITLE_COOLDOWN_MS,
    );
    if (dismissedSimilar) return false;

    const recentSame = ctx.recentSuggestedTitles.some(
      (entry) =>
        titlesAreNearDuplicate(entry.title, title) &&
        Date.now() - +new Date(entry.suggestedAt) < TOPIC_SUGGESTION_TITLE_COOLDOWN_MS,
    );
    if (recentSame) return false;

    return true;
  });
}
