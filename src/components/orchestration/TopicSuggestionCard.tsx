"use client";

import { Button } from "@/components/ui";
import { authHeaders } from "@/lib/api/auth-client";
import { Hash, X } from "lucide-react";
import { useState } from "react";

export type TopicSuggestionPayload = {
  id: string;
  type: string;
  title?: string | null;
  target_topic_id?: string | null;
  reason?: string | null;
  confidence?: number;
  message_ids?: string[];
};

export function TopicSuggestionCard({
  suggestion,
  onCreateTopic,
  onAccept,
  onDismiss,
}: {
  suggestion: TopicSuggestionPayload;
  onCreateTopic: (title: string) => void | Promise<void>;
  onAccept: (suggestionId: string) => void | Promise<void>;
  onDismiss: (suggestionId: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const title =
    suggestion.type === "move_to_existing_topic"
      ? `Move to existing topic`
      : suggestion.title ?? "New topic";
  const subtitle =
    suggestion.type === "move_to_existing_topic"
      ? suggestion.reason ?? "This conversation may fit better in an existing topic."
      : suggestion.reason ??
        "This conversation has become a focused workstream. Creating a topic keeps context scoped.";

  const handleCreate = async () => {
    if (!suggestion.title || busy) return;
    setBusy(true);
    try {
      await onCreateTopic(suggestion.title);
      await onAccept(suggestion.id);
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onDismiss(suggestion.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mb-3 max-w-3xl rounded-xl border border-accent-200 bg-accent-50/60 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-accent-600">
          <Hash className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Suggested topic: {title}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{subtitle}</p>
          {suggestion.message_ids?.length ? (
            <p className="mt-1 text-[11px] text-slate-500">
              Based on {suggestion.message_ids.length} recent message
              {suggestion.message_ids.length === 1 ? "" : "s"}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestion.type === "create_topic" && suggestion.title ? (
              <Button size="sm" onClick={handleCreate} disabled={busy}>
                Create topic
              </Button>
            ) : null}
            {suggestion.type === "move_to_existing_topic" ? (
              <Button size="sm" variant="secondary" disabled title="Coming soon">
                Move to topic
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={handleDismiss} disabled={busy}>
              Dismiss
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600"
          aria-label="Dismiss suggestion"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export async function dismissTopicSuggestionApi(suggestionId: string, workspaceId: string) {
  const headers = await authHeaders();
  await fetch(`/api/topic-suggestions/${suggestionId}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "dismissed", workspaceId }),
  });
}

export async function acceptTopicSuggestionApi(suggestionId: string, workspaceId: string) {
  const headers = await authHeaders();
  await fetch(`/api/topic-suggestions/${suggestionId}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "accepted", workspaceId }),
  });
}
