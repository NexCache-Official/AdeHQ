import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveMemory } from "@/lib/memory/active-filter";
import { suggestionKeyForTopicSummary } from "@/lib/memory/fingerprint";
import {
  isTerminalSuggestionState,
  type MemorySuggestionState,
} from "@/lib/memory/suggestion-lifecycle";
import { buildMemoryEntryFields } from "@/lib/memory/build-entry";
import { resolveMemoryInsert } from "@/lib/memory/dedupe";
import { normalizeMemoryScope, scopeUsesTopicId } from "@/lib/memory/scope-rules";
import { memoryCuratorContext } from "./save-memory";
import type { TopicSummary } from "./types";
import { fetchTopicSummary, updateMemorySuggestionLifecycle } from "./persistence";

async function suggestionAlreadySavedAsMemory(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
  userId: string,
  suggestion: TopicSummary["suggestedMemory"][number],
  suggestionIndex: number,
): Promise<boolean> {
  const scope = normalizeMemoryScope(suggestion.scope);
  const topicScoped = scopeUsesTopicId(scope);
  const fields = buildMemoryEntryFields({
    workspaceId,
    roomId,
    topicId: topicScoped ? topicId : null,
    userId,
    suggestion,
    suggestionIndex,
    scopeOverride: scope,
    dedupeKey: "",
    curatorContext: memoryCuratorContext({
      workspaceId,
      roomId,
      topicId: topicScoped ? topicId : null,
      userId,
      sourceMessageId: suggestion.sourceMessageId,
      sourceEmployeeId: suggestion.suggestedByEmployeeId,
    }),
  });

  const suggestionKey = suggestionKeyForTopicSummary(topicId, {
    title: suggestion.title,
    content: suggestion.content,
    text: suggestion.text,
    sourceMessageId: suggestion.sourceMessageId,
  });

  const { existing } = await resolveMemoryInsert(client, workspaceId, {
    workspaceId,
    title: fields.title,
    content: fields.content,
    scope,
    roomId,
    topicId: topicScoped ? topicId : null,
    sourceMessageId: suggestion.sourceMessageId,
    suggestionKey,
  });

  return Boolean(existing && isActiveMemory(existing));
}

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

  for (const [index, suggestion] of params.summary.suggestedMemory.entries()) {
    const key = suggestionKeyForTopicSummary(params.topicId, {
      title: suggestion.title,
      content: suggestion.content,
      text: suggestion.text,
      sourceMessageId: suggestion.sourceMessageId,
    });
    if (isTerminalSuggestionState(lifecycle[key])) continue;

    const alreadySaved = await suggestionAlreadySavedAsMemory(
      client,
      params.workspaceId,
      params.roomId,
      params.topicId,
      params.userId,
      suggestion,
      index,
    );
    if (alreadySaved) {
      lifecycle[key] = "already_saved";
      changed = true;
    }
  }

  if (!changed) return params.summary;

  const merged = { ...params.summary, memorySuggestionLifecycle: lifecycle };

  if (params.persist !== false) {
    for (const [key, state] of Object.entries(lifecycle)) {
      if (state === "already_saved" && params.summary.memorySuggestionLifecycle?.[key] !== "already_saved") {
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
