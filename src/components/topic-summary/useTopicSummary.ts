"use client";

import { useCallback, useEffect, useState } from "react";
import type { TopicSummary } from "@/lib/topic-summary/types";
import {
  fetchTopicSummaryClient,
  refreshTopicSummaryClient,
  TOPIC_SUMMARY_UPDATED_EVENT,
} from "@/lib/topic-summary/client";

const SKIP_REASON_LABELS: Record<string, string> = {
  casual_conversation: "Not enough substantive discussion to summarize yet.",
  insufficient_messages: "Need at least a few messages before summarizing.",
  no_meaningful_change: "Summary is already up to date with the latest messages.",
  cooldown: "Summary was refreshed recently — try again in a minute.",
  chat_cleared: "Chat was cleared — send new messages, then summarize again.",
  generation_failed: "Couldn't generate a summary just now — try again in a moment.",
};

export function useTopicSummary(topicId: string | undefined) {
  const [summary, setSummary] = useState<TopicSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!topicId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTopicSummaryClient(topicId);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!topicId) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        topicId: string;
        cleared?: boolean;
        summary?: TopicSummary | null;
      }>).detail;
      if (detail?.topicId !== topicId) return;
      if (detail.cleared) {
        setSummary(null);
        return;
      }
      if (detail.summary !== undefined) {
        setSummary(detail.summary);
        return;
      }
      void load();
    };
    window.addEventListener(TOPIC_SUMMARY_UPDATED_EVENT, handler);
    return () => window.removeEventListener(TOPIC_SUMMARY_UPDATED_EVENT, handler);
  }, [topicId, load]);

  const refresh = useCallback(
    async (options?: { manual?: boolean; force?: boolean }) => {
      if (!topicId) return null;
      setRefreshing(true);
      setError(null);
      setInfo(null);
      try {
        const result = await refreshTopicSummaryClient(topicId, {
          manual: options?.manual !== false,
          force: Boolean(options?.force),
        });
        if (result.summary) {
          setSummary(result.summary);
        } else if (result.skippedReason === "chat_cleared") {
          setSummary(null);
        }
        if (result.skippedReason === "generation_failed") {
          setError(SKIP_REASON_LABELS.generation_failed);
        } else if (!result.refreshed && result.skippedReason) {
          setInfo(SKIP_REASON_LABELS[result.skippedReason] ?? "Summary was not updated.");
        } else if (result.refreshed && result.skippedReason === "no_meaningful_change") {
          setInfo(SKIP_REASON_LABELS.no_meaningful_change);
        }
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to refresh summary");
        throw err;
      } finally {
        setRefreshing(false);
      }
    },
    [topicId],
  );

  return {
    summary,
    loading,
    refreshing,
    error,
    info,
    refresh,
    reload: load,
  };
}
