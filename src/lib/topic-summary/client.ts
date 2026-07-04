import { authHeaders } from "@/lib/api/auth-client";
import type { MemoryEntry } from "@/lib/types";
import type { TopicSummary } from "./types";

export const TOPIC_SUMMARY_UPDATED_EVENT = "adehq:topic-summary-updated";
export const MEMORY_UPDATED_EVENT = "adehq:memory-updated";

export type MemorySaveResult = {
  memoryId: string;
  duplicate: boolean;
  memory?: MemoryEntry;
};

export function notifyTopicSummaryUpdated(
  topicId: string,
  options?: { cleared?: boolean },
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TOPIC_SUMMARY_UPDATED_EVENT, {
      detail: { topicId, cleared: options?.cleared },
    }),
  );
}

export function notifyMemoryUpdated(detail: {
  memory?: MemoryEntry;
  memoryId: string;
  topicId?: string;
  duplicate?: boolean;
  deleted?: boolean;
}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MEMORY_UPDATED_EVENT, { detail }));
}

export async function fetchTopicSummaryClient(topicId: string): Promise<TopicSummary | null> {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/summary`, { headers });
  if (!res.ok) return null;
  const payload = await res.json();
  return (payload.summary as TopicSummary | null) ?? null;
}

export async function refreshTopicSummaryClient(
  topicId: string,
  manual = true,
): Promise<{ summary: TopicSummary | null; refreshed: boolean; skippedReason?: string }> {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/summary/refresh`, {
    method: "POST",
    headers,
    body: JSON.stringify({ manual }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? "Unable to refresh topic summary.");
  }
  const payload = await res.json();
  notifyTopicSummaryUpdated(topicId);
  return {
    summary: (payload.summary as TopicSummary | null) ?? null,
    refreshed: Boolean(payload.refreshed),
    skippedReason: payload.skippedReason as string | undefined,
  };
}

async function parseMemorySaveResponse(res: Response): Promise<MemorySaveResult> {
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? "Unable to save memory.");
  }
  const payload = await res.json();
  const result: MemorySaveResult = {
    memoryId: String(payload.memoryId),
    duplicate: Boolean(payload.duplicate),
    memory: payload.memory as MemoryEntry | undefined,
  };
  return result;
}

export async function saveTopicSummaryToMemoryClient(topicId: string): Promise<MemorySaveResult> {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/summary/save-memory`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const result = await parseMemorySaveResponse(res);
  notifyTopicSummaryUpdated(topicId);
  notifyMemoryUpdated({ ...result, topicId });
  return result;
}

export async function saveSuggestedMemoryClient(
  topicId: string,
  suggestionIndex: number,
  options?: { scope?: import("@/lib/types").MemoryScope },
): Promise<MemorySaveResult> {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/summary/save-memory`, {
    method: "POST",
    headers,
    body: JSON.stringify({ suggestionIndex, scope: options?.scope }),
  });
  const result = await parseMemorySaveResponse(res);
  notifyTopicSummaryUpdated(topicId);
  notifyMemoryUpdated({ ...result, topicId });
  return result;
}

export async function dismissMemorySuggestionClient(
  topicId: string,
  suggestionKey: string,
): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/memory-suggestions/dismiss`, {
    method: "POST",
    headers,
    body: JSON.stringify({ suggestionKey }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? "Unable to dismiss memory suggestion.");
  }
}

export async function saveFileMemorySuggestionClient(
  topicId: string,
  payload: {
    text: string;
    reason?: string;
    sourceFileId?: string;
    sourceChunkId?: string;
    sourceArtifactId?: string;
    sourceMessageId?: string;
    scope?: import("@/lib/types").MemoryScope;
  },
): Promise<MemorySaveResult> {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/memory-suggestions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const result = await parseMemorySaveResponse(res);
  notifyMemoryUpdated({ ...result, topicId });
  return result;
}
