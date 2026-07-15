"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

export type AgentRunRealtimeUpdate = {
  runId: string;
  topicId: string;
  status: string;
  cancelReason?: string | null;
  errorMessage?: string | null;
};

/**
 * Live agent_runs status for the active topic — so when another viewer
 * pause-ai cancels runs, every open RoomChat clears typing/stream UI.
 */
export function useAgentRunsRealtime(params: {
  enabled: boolean;
  workspaceId?: string | null;
  topicId?: string | null;
  onUpdate: (run: AgentRunRealtimeUpdate) => void;
}): void {
  const onUpdateRef = useRef(params.onUpdate);

  useEffect(() => {
    onUpdateRef.current = params.onUpdate;
  }, [params.onUpdate]);

  useEffect(() => {
    if (!params.enabled || !params.workspaceId || !params.topicId) return;

    const workspaceId = params.workspaceId;
    const topicId = params.topicId;

    const channel = supabase
      .channel(`agent-runs-live:${workspaceId}:${topicId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "agent_runs",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (String(row.topic_id ?? "") !== topicId) return;
          const meta = (row.run_metadata as Record<string, unknown> | null) ?? {};
          onUpdateRef.current({
            runId: String(row.id),
            topicId,
            status: String(row.status ?? ""),
            cancelReason:
              typeof meta.cancelReason === "string" ? meta.cancelReason : null,
            errorMessage: row.error_message ? String(row.error_message) : null,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [params.enabled, params.topicId, params.workspaceId]);
}
