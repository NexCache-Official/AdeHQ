"use client";

import { useEffect, useRef } from "react";
import { mapBrowserResearchRunRow } from "@/lib/ai/browser-research/map-run-row";
import type { BrowserResearchRun } from "@/lib/ai/browser-research/types";
import { upsertBrowserResearchRun } from "@/lib/ai/browser-research/client-api";
import { supabase } from "@/lib/supabase/client";
import type { RoomMessage } from "@/lib/types";

type UseBrowserResearchRealtimeParams = {
  enabled: boolean;
  workspaceId?: string;
  topicId?: string;
  onRunUpdated: (run: BrowserResearchRun) => void;
  onChatReply?: (message: RoomMessage) => void;
};

function mapMessageRow(row: Record<string, unknown>): RoomMessage {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    senderType: row.sender_type as RoomMessage["senderType"],
    senderId: String(row.sender_id),
    senderName: String(row.sender_name ?? "AI"),
    content: String(row.content ?? ""),
    agentRunId: row.agent_run_id ? String(row.agent_run_id) : undefined,
    createdAt: String(row.created_at),
  };
}

/** Subscribe to browser_research_runs + messages for live research cards and replies. */
export function useBrowserResearchRealtime(params: UseBrowserResearchRealtimeParams): void {
  const deliveredRepliesRef = useRef(new Set<string>());
  const onRunUpdatedRef = useRef(params.onRunUpdated);
  const onChatReplyRef = useRef(params.onChatReply);

  useEffect(() => {
    onRunUpdatedRef.current = params.onRunUpdated;
    onChatReplyRef.current = params.onChatReply;
  }, [params.onChatReply, params.onRunUpdated]);

  useEffect(() => {
    if (!params.enabled || !params.workspaceId || !params.topicId) return;

    const workspaceId = params.workspaceId;
    const topicId = params.topicId;

    const deliverReply = (message: RoomMessage) => {
      if (deliveredRepliesRef.current.has(message.id)) return;
      deliveredRepliesRef.current.add(message.id);
      onChatReplyRef.current?.(message);
    };

    const channel = supabase
      .channel(`browser-research-live:${workspaceId}:${topicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "browser_research_runs",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<
            string,
            unknown
          > | null;
          if (!row || String(row.topic_id ?? "") !== topicId) return;

          const run = mapBrowserResearchRunRow(row);
          onRunUpdatedRef.current(run);

          const chatReplyMessageId =
            typeof run.metadata.chatReplyMessageId === "string"
              ? run.metadata.chatReplyMessageId
              : undefined;
          if (!chatReplyMessageId || deliveredRepliesRef.current.has(chatReplyMessageId)) {
            return;
          }

          void supabase
            .from("messages")
            .select("*")
            .eq("workspace_id", workspaceId)
            .eq("id", chatReplyMessageId)
            .maybeSingle()
            .then(({ data }) => {
              if (data) deliverReply(mapMessageRow(data as Record<string, unknown>));
            });
        },
      )
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
          if (row.sender_type !== "ai") return;
          deliverReply(mapMessageRow(row));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [params.enabled, params.topicId, params.workspaceId]);
}
