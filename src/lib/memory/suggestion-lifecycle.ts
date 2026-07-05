import {
  suggestionContentFingerprint,
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

function terminalLifecycleMatch(
  key: string,
  topicId: string,
  suggestion: TopicSummarySuggestionKeyInput | undefined,
  lifecycle?: Record<string, MemorySuggestionState>,
): MemorySuggestionState | undefined {
  if (!lifecycle) return undefined;
  const direct = lifecycle[key];
  if (direct && isTerminalSuggestionState(direct)) return direct;
  if (!suggestion) return undefined;
  const fingerprint = suggestionContentFingerprint(topicId, suggestion);
  for (const [storedKey, state] of Object.entries(lifecycle)) {
    if (!isTerminalSuggestionState(state)) continue;
    if (storedKey === key || storedKey.includes(fingerprint)) return state;
  }
  return undefined;
}

/** Resolve lifecycle for a suggestion, matching stable keys across summary regenerations. */
export function resolveSuggestionStateForSuggestion(
  topicId: string,
  suggestion: TopicSummarySuggestionKeyInput,
  serverLifecycle?: Record<string, MemorySuggestionState>,
  localLifecycle?: Record<string, MemorySuggestionState>,
  optimistic?: MemorySuggestionState,
): MemorySuggestionState {
  const key = topicSummarySuggestionKey(topicId, suggestion);
  return (
    terminalLifecycleMatch(key, topicId, suggestion, serverLifecycle) ??
    terminalLifecycleMatch(key, topicId, suggestion, localLifecycle) ??
    resolveSuggestionState(key, serverLifecycle, localLifecycle, optimistic)
  );
}

export function isSuggestionTerminalInLifecycle(
  topicId: string,
  suggestion: TopicSummarySuggestionKeyInput,
  lifecycle?: Record<string, MemorySuggestionState>,
): boolean {
  return isTerminalSuggestionState(
    resolveSuggestionStateForSuggestion(topicId, suggestion, lifecycle),
  );
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
