"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { HUMAN_TYPING_QUIET_MS } from "@/lib/orchestration/human-burst";

export type TopicPresencePeer = {
  userId: string;
  displayName: string;
  typing: boolean;
  lastTypedAt: string;
};

type PresencePayload = {
  userId: string;
  displayName: string;
  typing: boolean;
  lastTypedAt: string;
};

/**
 * Topic-scoped Supabase Presence for human typing.
 * AI employees are not presence peers — they use activeRuns / stream UI.
 */
export function useTopicPresence(params: {
  enabled: boolean;
  workspaceId?: string | null;
  topicId?: string | null;
  userId?: string | null;
  displayName?: string | null;
}): {
  typingHumans: TopicPresencePeer[];
  anyHumanTyping: boolean;
  setLocalTyping: (typing: boolean) => void;
} {
  const [peers, setPeers] = useState<TopicPresencePeer[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const localTypingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaRef = useRef({
    userId: params.userId,
    displayName: params.displayName,
  });

  useEffect(() => {
    metaRef.current = {
      userId: params.userId,
      displayName: params.displayName,
    };
  }, [params.userId, params.displayName]);

  const syncFromChannel = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    const state = channel.presenceState<PresencePayload>();
    const next: TopicPresencePeer[] = [];
    for (const key of Object.keys(state)) {
      const entries = state[key] ?? [];
      for (const entry of entries) {
        if (!entry?.userId) continue;
        next.push({
          userId: String(entry.userId),
          displayName: String(entry.displayName || "Someone"),
          typing: Boolean(entry.typing),
          lastTypedAt: String(entry.lastTypedAt || new Date().toISOString()),
        });
      }
    }
    // Dedupe by userId (keep latest typing true if any)
    const byUser = new Map<string, TopicPresencePeer>();
    for (const peer of next) {
      const prev = byUser.get(peer.userId);
      if (!prev || peer.typing || (!prev.typing && peer.lastTypedAt >= prev.lastTypedAt)) {
        byUser.set(peer.userId, peer);
      }
    }
    setPeers([...byUser.values()]);
  }, []);

  const trackPresence = useCallback(async (typing: boolean) => {
    const channel = channelRef.current;
    const { userId, displayName } = metaRef.current;
    if (!channel || !userId) return;
    localTypingRef.current = typing;
    await channel.track({
      userId,
      displayName: displayName?.trim() || "Someone",
      typing,
      lastTypedAt: new Date().toISOString(),
    } satisfies PresencePayload);
  }, []);

  const setLocalTyping = useCallback(
    (typing: boolean) => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (!params.enabled || !params.userId) return;

      if (typing) {
        void trackPresence(true);
        idleTimerRef.current = setTimeout(() => {
          void trackPresence(false);
        }, HUMAN_TYPING_QUIET_MS);
      } else {
        void trackPresence(false);
      }
    },
    [params.enabled, params.userId, trackPresence],
  );

  useEffect(() => {
    if (!params.enabled || !params.workspaceId || !params.topicId || !params.userId) {
      setPeers([]);
      return;
    }

    const workspaceId = params.workspaceId;
    const topicId = params.topicId;
    const channel = supabase.channel(`topic-presence:${workspaceId}:${topicId}`, {
      config: { presence: { key: params.userId } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => syncFromChannel())
      .on("presence", { event: "join" }, () => syncFromChannel())
      .on("presence", { event: "leave" }, () => syncFromChannel())
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        await trackPresence(false);
      });

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      void channel.untrack();
      void supabase.removeChannel(channel);
      channelRef.current = null;
      setPeers([]);
    };
  }, [
    params.enabled,
    params.workspaceId,
    params.topicId,
    params.userId,
    syncFromChannel,
    trackPresence,
  ]);

  const typingHumans = useMemo(
    () => peers.filter((p) => p.typing),
    [peers],
  );
  const anyHumanTyping = typingHumans.length > 0;

  return { typingHumans, anyHumanTyping, setLocalTyping };
}
