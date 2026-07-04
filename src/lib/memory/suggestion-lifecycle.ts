import {
  suggestionKeyForTopicSummary,
  type TopicSummarySuggestionKeyInput,
} from "./fingerprint";

export type MemorySuggestionState =
  | "suggested"
  | "saving"
  | "saved"
  | "dismissed"
  | "already_saved"
  | "failed";

const LOCAL_PREFIX = "adehq:memory-suggestion-lifecycle:";

export function topicSummarySuggestionKey(
  topicId: string,
  suggestion: TopicSummarySuggestionKeyInput,
): string {
  return suggestionKeyForTopicSummary(topicId, suggestion);
}

export function isTerminalSuggestionState(state?: MemorySuggestionState): boolean {
  return (
    state === "saved" ||
    state === "dismissed" ||
    state === "already_saved"
  );
}

export function shouldHideSuggestion(state?: MemorySuggestionState): boolean {
  return isTerminalSuggestionState(state);
}

export function readLocalSuggestionLifecycle(
  topicId: string,
): Record<string, MemorySuggestionState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(`${LOCAL_PREFIX}${topicId}`);
    return raw ? (JSON.parse(raw) as Record<string, MemorySuggestionState>) : {};
  } catch {
    return {};
  }
}

export function writeLocalSuggestionLifecycle(
  topicId: string,
  lifecycle: Record<string, MemorySuggestionState>,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${LOCAL_PREFIX}${topicId}`, JSON.stringify(lifecycle));
  } catch {
    // ignore quota errors
  }
}

export function clearLocalTopicSummaryUiState(topicId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${LOCAL_PREFIX}${topicId}`);
    localStorage.removeItem(`adehq:dismissed-next-actions:${topicId}`);
  } catch {
    // ignore
  }
}

export function setLocalSuggestionState(
  topicId: string,
  key: string,
  state: MemorySuggestionState,
): void {
  const current = readLocalSuggestionLifecycle(topicId);
  current[key] = state;
  writeLocalSuggestionLifecycle(topicId, current);
}

/** Merge server lifecycle with local optimistic state; server wins for terminal states. */
export function resolveSuggestionState(
  key: string,
  serverLifecycle?: Record<string, MemorySuggestionState>,
  localLifecycle?: Record<string, MemorySuggestionState>,
  optimistic?: MemorySuggestionState,
): MemorySuggestionState {
  const server = serverLifecycle?.[key];
  if (server && isTerminalSuggestionState(server)) return server;
  const local = localLifecycle?.[key];
  if (local && isTerminalSuggestionState(local)) return local;
  if (optimistic === "saving") return "saving";
  if (optimistic === "failed") return "failed";
  return server ?? local ?? optimistic ?? "suggested";
}
