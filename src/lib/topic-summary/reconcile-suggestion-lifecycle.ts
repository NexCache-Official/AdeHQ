import type { SupabaseClient } from "@supabase/supabase-js";
import { findExistingMemoryForSuggestion } from "@/lib/memory/find-existing";
import { suggestionKeyForTopicSummary } from "@/lib/memory/fingerprint";
import {
  isSuggestionTerminalInLifecycle,
  isTerminalSuggestionState,
  resolveSuggestionStateForSuggestion,
  type MemorySuggestionState,
} from "@/lib/memory/suggestion-lifecycle";
import { normalizeMemoryScope } from "@/lib/memory/scope-rules";
import type { TopicSummary } from "./types";
import { fetchTopicSummary, updateMemorySuggestionLifecycle } from "./persistence";

/** Mark suggestions as already_saved when matching active memory exists. Persists lifecycle updates. */
export async function reconcileTopicSummarySuggestionLifecycle(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    userId: string;
    summary: TopicSummary;
    persist?: boolean;
  },
): Promise<TopicSummary> {
  const lifecycle: Record<string, MemorySuggestionState> = {
    ...(params.summary.memorySuggestionLifecycle ?? {}),
  };
  let changed = false;

  for (const suggestion of params.summary.suggestedMemory) {
    const suggestionInput = {
      title: suggestion.title,
      content: suggestion.content,
      text: suggestion.text,
      sourceMessageId: suggestion.sourceMessageId,
    };
    const key = suggestionKeyForTopicSummary(params.topicId, suggestionInput);

    if (isSuggestionTerminalInLifecycle(params.topicId, suggestionInput, lifecycle)) {
      const resolved = resolveSuggestionStateForSuggestion(
        params.topicId,
        suggestionInput,
        lifecycle,
      );
      if (isTerminalSuggestionState(resolved) && lifecycle[key] !== resolved) {
        lifecycle[key] = resolved;
        changed = true;
      }
      continue;
    }

    const scope = normalizeMemoryScope(suggestion.scope);
    const existing = await findExistingMemoryForSuggestion(client, {
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      title: suggestion.title ?? suggestion.text ?? "Memory",
      content: suggestion.content ?? suggestion.text ?? "",
      scope,
      sourceMessageId: suggestion.sourceMessageId,
      suggestionKey: key,
    });

    if (existing) {
      lifecycle[key] = "already_saved";
      changed = true;
    }
  }

  if (!changed) return params.summary;

  const merged = { ...params.summary, memorySuggestionLifecycle: lifecycle };

  if (params.persist !== false) {
    for (const [key, state] of Object.entries(lifecycle)) {
      if (
        isTerminalSuggestionState(state) &&
        params.summary.memorySuggestionLifecycle?.[key] !== state
      ) {
        await updateMemorySuggestionLifecycle(client, {
          workspaceId: params.workspaceId,
          topicId: params.topicId,
          suggestionKey: key,
          state,
        }).catch(() => undefined);
      }
    }
  }

  return merged;
}

export async function fetchReconciledTopicSummary(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
  userId: string,
): Promise<TopicSummary | null> {
  const summary = await fetchTopicSummary(client, workspaceId, topicId);
  if (!summary) return null;
  return reconcileTopicSummarySuggestionLifecycle(client, {
    workspaceId,
    roomId,
    topicId,
    userId,
    summary,
  });
}
