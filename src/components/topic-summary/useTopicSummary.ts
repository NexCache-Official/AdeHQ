"use client";

import { useCallback, useEffect, useState } from "react";
import type { TopicSummary } from "@/lib/topic-summary/types";
import {
  fetchTopicSummaryClient,
  refreshTopicSummaryClient,
  TOPIC_SUMMARY_UPDATED_EVENT,
} from "@/lib/topic-summary/client";

export function useTopicSummary(topicId: string | undefined) {
  const [summary, setSummary] = useState<TopicSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const detail = (event as CustomEvent<{ topicId: string; cleared?: boolean }>).detail;
      if (detail?.topicId !== topicId) return;
      if (detail.cleared) setSummary(null);
      void load();
    };
    window.addEventListener(TOPIC_SUMMARY_UPDATED_EVENT, handler);
    return () => window.removeEventListener(TOPIC_SUMMARY_UPDATED_EVENT, handler);
  }, [topicId, load]);

  const refresh = useCallback(
    async (manual = true) => {
      if (!topicId) return null;
      setRefreshing(true);
      setError(null);
      try {
        const result = await refreshTopicSummaryClient(topicId, manual);
        if (result.summary) setSummary(result.summary);
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
    refresh,
    reload: load,
  };
}
