"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import { messageFromRow } from "@/lib/supabase/persistence";
import type { RoomMessage } from "@/lib/types";

type UseMessagesRealtimeParams = {
  enabled: boolean;
  workspaceId?: string;
  topicId?: string;
  onInsert: (message: RoomMessage) => void;
  /** Called for later patches to an existing message (e.g. artifacts attached
   * after a deferred background job, or a streamed reply's content growing). */
  onUpdate?: (message: RoomMessage) => void;
};

/**
 * General-purpose live delivery for chat messages in the active topic — the
 * primary mechanism so replies (and any later patches to them) appear for every
 * viewer without a manual reload or a slow whole-workspace refetch. Scoped by
 * topic so multiple open rooms don't cross-talk. Unlike the browser-research
 * realtime hook, this is not gated behind any feature flag — it must work for
 * every room and DM, with or without research/tool capabilities granted.
 */
export function useMessagesRealtime(params: UseMessagesRealtimeParams): void {
  const onInsertRef = useRef(params.onInsert);
  const onUpdateRef = useRef(params.onUpdate);
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    onInsertRef.current = params.onInsert;
    onUpdateRef.current = params.onUpdate;
  }, [params.onInsert, params.onUpdate]);

  useEffect(() => {
    if (!params.enabled || !params.workspaceId || !params.topicId) return;

    const workspaceId = params.workspaceId;
    const topicId = params.topicId;
    seenRef.current = new Set();

    const channel = supabase
      .channel(`messages-live:${workspaceId}:${topicId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (String(row.topic_id ?? "") !== topicId) return;
          const message = messageFromRow(row);
          if (seenRef.current.has(message.id)) return;
          seenRef.current.add(message.id);
          onInsertRef.current(message);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (String(row.topic_id ?? "") !== topicId) return;
          const message = messageFromRow(row);
          seenRef.current.add(message.id);
          onUpdateRef.current?.(message);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [params.enabled, params.topicId, params.workspaceId]);
}
