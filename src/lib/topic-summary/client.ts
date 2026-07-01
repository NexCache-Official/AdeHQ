import { authHeaders } from "@/lib/api/auth-client";
import type { TopicSummary } from "./types";

export const TOPIC_SUMMARY_UPDATED_EVENT = "adehq:topic-summary-updated";

export function notifyTopicSummaryUpdated(topicId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TOPIC_SUMMARY_UPDATED_EVENT, { detail: { topicId } }),
  );
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

export async function saveTopicSummaryToMemoryClient(topicId: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/summary/save-memory`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? "Unable to save summary to memory.");
  }
  notifyTopicSummaryUpdated(topicId);
}

export async function saveSuggestedMemoryClient(
  topicId: string,
  suggestionIndex: number,
): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`/api/topics/${topicId}/summary/save-memory`, {
    method: "POST",
    headers,
    body: JSON.stringify({ suggestionIndex }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? "Unable to save memory suggestion.");
  }
  notifyTopicSummaryUpdated(topicId);
}
