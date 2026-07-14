import type { OrchestratorInput, TopicStewardSuggestion } from "./types";
import { titleRelevanceTokens } from "./topic-title";

/** Same / near-duplicate title in same room — suppress repeat suggestions. */
export const TOPIC_SUGGESTION_TITLE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type TopicSuggestionGovernanceContext = {
  dismissedTitles: Array<{ title: string; dismissedAt: string }>;
  recentSuggestedTitles: Array<{ title: string; suggestedAt: string }>;
  dismissedTriggerMessageIds: string[];
  /** Active non-General topics in the room (block / redirect near-duplicate creates). */
  existingTopics?: Array<{ id: string; title: string }>;
  /** @deprecated Prefer existingTopics */
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

  // Same product stem (e.g. "Harborline Guarantor Shield …") with different suffixes.
  const coreA = tokensA.slice(0, 3);
  const coreB = tokensB.slice(0, 3);
  const sharedCore = coreA.filter((t) => coreB.includes(t)).length;
  if (sharedCore >= 2) return true;

  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = overlap / union;
  if (jaccard >= 0.4) return true;

  const minLen = Math.min(tokensA.length, tokensB.length);
  return overlap >= 2 && overlap >= Math.ceil(minLen * 0.66);
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

  const existingTopics =
    ctx.existingTopics ??
    (ctx.existingTopicTitles ?? []).map((title) => ({ id: "", title }));

  return suggestions.flatMap((suggestion) => {
    const title = suggestionTitle(suggestion);
    const norm = normalizeTopicTitle(title);
    if (!norm) return [];

    // Near-duplicate of an existing topic → never create another banner.
    // (Move-to-existing accept is not wired yet; suppressing is better than a dupe.)
    if (suggestion.type === "create_topic") {
      const match = existingTopics.find((existing) =>
        titlesAreNearDuplicate(title, existing.title),
      );
      if (match) return [];
    }

    const dismissedSimilar = ctx.dismissedTitles.some(
      (entry) =>
        titlesAreNearDuplicate(entry.title, title) &&
        Date.now() - +new Date(entry.dismissedAt) < TOPIC_SUGGESTION_TITLE_COOLDOWN_MS,
    );
    if (dismissedSimilar) return [];

    const recentSame = ctx.recentSuggestedTitles.some(
      (entry) =>
        titlesAreNearDuplicate(entry.title, title) &&
        Date.now() - +new Date(entry.suggestedAt) < TOPIC_SUGGESTION_TITLE_COOLDOWN_MS,
    );
    if (recentSame) return [];

    return [suggestion];
  });
}
