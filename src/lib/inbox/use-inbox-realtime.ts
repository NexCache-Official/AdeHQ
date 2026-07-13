"use client";

/**
 * Patch-based inbox realtime (Slice B).
 *
 * Subscribes once to email_threads / email_messages / email_outbox for the
 * workspace and emits typed change events. It never triggers a full demo-store
 * reload; the consumer patches only the affected folder page and open thread.
 */

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

export type InboxRealtimeEvent = {
  table: "email_threads" | "email_messages" | "email_outbox";
  eventType: "INSERT" | "UPDATE" | "DELETE";
  threadId: string | null;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

export function useInboxRealtime(params: {
  workspaceId: string | null | undefined;
  enabled: boolean;
  onEvent: (event: InboxRealtimeEvent) => void;
}) {
  const { workspaceId, enabled, onEvent } = params;
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !workspaceId) return;

    const filter = `workspace_id=eq.${workspaceId}`;
    const channel = supabase.channel(`inbox:${workspaceId}`);

    const relay =
      (table: InboxRealtimeEvent["table"]) =>
      (payload: {
        eventType: string;
        new: Record<string, unknown> | null;
        old: Record<string, unknown> | null;
      }) => {
        const next = payload.new ?? null;
        const prev = payload.old ?? null;
        const threadId =
          (next?.thread_id as string) ??
          (next?.id as string) ??
          (prev?.thread_id as string) ??
          (prev?.id as string) ??
          null;
        handlerRef.current({
          table,
          eventType: payload.eventType as InboxRealtimeEvent["eventType"],
          threadId: table === "email_threads" ? ((next?.id as string) ?? (prev?.id as string) ?? null) : threadId,
          new: next,
          old: prev,
        });
      };

    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "email_threads", filter },
        relay("email_threads"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "email_messages", filter },
        relay("email_messages"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "email_outbox", filter },
        relay("email_outbox"),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, enabled]);
}
