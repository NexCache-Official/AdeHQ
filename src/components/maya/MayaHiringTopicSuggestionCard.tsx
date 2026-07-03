"use client";

import { Loader2 } from "lucide-react";
import {
  mayaHiringTopicSuggestionBody,
  mayaHiringTopicSuggestionTitle,
} from "@/lib/hiring/maya-hiring-proposal";
import { cn } from "@/lib/utils";

export type TopicSuggestionAction = "create_topic" | "continue_here" | "cancel";

type MayaHiringTopicSuggestionCardProps = {
  roleTitle: string;
  activeAction?: TopicSuggestionAction | null;
  disabled?: boolean;
  onAction: (action: TopicSuggestionAction) => void;
  className?: string;
};

export function MayaHiringTopicSuggestionCard({
  roleTitle,
  activeAction,
  disabled = false,
  onAction,
  className,
}: MayaHiringTopicSuggestionCardProps) {
  const isCreating = activeAction === "create_topic";
  const isContinuing = activeAction === "continue_here";

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface px-4 py-3.5 shadow-sm",
        className,
      )}
    >
      <div className="text-sm font-semibold text-ink">{mayaHiringTopicSuggestionTitle()}</div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
        {mayaHiringTopicSuggestionBody(roleTitle)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || isCreating || isContinuing}
          onClick={() => onAction("create_topic")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {isCreating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isCreating ? "Creating topic…" : "Create topic"}
        </button>
        <button
          type="button"
          disabled={disabled || isCreating || isContinuing}
          onClick={() => onAction("continue_here")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
        >
          {isContinuing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isContinuing ? "Starting…" : "Continue here"}
        </button>
        <button
          type="button"
          disabled={disabled || isCreating || isContinuing}
          onClick={() => onAction("cancel")}
          className="rounded-lg px-3 py-1.5 text-xs text-ink-3 hover:bg-muted disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
