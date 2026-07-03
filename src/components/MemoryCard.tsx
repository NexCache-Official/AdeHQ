"use client";

import { useMemo } from "react";
import type { MemoryEntry } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import {
  memorySavedByLabel,
  memoryScopeLabel,
  memorySourceLabel,
  memorySuggestedByLabel,
  type MemoryAttributionContext,
} from "@/lib/memory/attribution";
import { memoryPreviewText } from "@/lib/memory/build-entry";
import { jumpFromMemory } from "@/lib/navigation/jump-to-source";
import { cn, timeAgo } from "@/lib/utils";
import { Check, Copy, ExternalLink, Pin, PinOff } from "lucide-react";
import { useState } from "react";

const STATUS_STYLES: Record<MemoryEntry["status"], string> = {
  draft: "bg-muted text-ink-3",
  approved: "bg-emerald-500/12 text-emerald-700",
  pinned: "bg-accent-500/12 text-accent-d",
  superseded: "bg-muted text-ink-3 line-through",
};

type MemoryCardProps = {
  memory: MemoryEntry;
  compact?: boolean;
  showActions?: boolean;
};

export function MemoryCard({ memory, compact = false, showActions = true }: MemoryCardProps) {
  const { state, actions } = useStore();
  const [copied, setCopied] = useState(false);

  const ctx: MemoryAttributionContext = useMemo(
    () => ({
      rooms: state.rooms,
      topics: state.topics,
      employees: state.employees,
      workspaceMembers: state.workspaceMembers,
      currentUserId: state.user?.id,
      currentUserName: state.user?.name,
    }),
    [state.rooms, state.topics, state.employees, state.workspaceMembers, state.user],
  );

  const preview = memoryPreviewText(memory);
  const category = memory.category ?? "Other";
  const scopeLabel = memoryScopeLabel(memory, ctx);
  const sourceLabel = memorySourceLabel(memory, ctx);
  const suggestedBy = memorySuggestedByLabel(memory, ctx);
  const savedBy = memorySavedByLabel(memory, ctx);
  const canJumpSource = Boolean(memory.sourceMessageId || memory.topicId);

  const togglePin = () =>
    actions.updateMemory(memory.id, {
      status: memory.status === "pinned" ? "approved" : "pinned",
    });

  const copy = async () => {
    await navigator.clipboard.writeText(`${memory.title}\n\n${preview || memory.content}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article
      className={cn(
        "group rounded-xl border border-border bg-surface transition-colors hover:border-border-2",
        compact ? "p-3" : "p-3.5",
        memory.status === "pinned" && "border-accent/30 bg-accent-soft/20",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-ink-2">
            {category}
          </span>
          <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", STATUS_STYLES[memory.status])}>
            {memory.status}
          </span>
          <span className="rounded-md border border-border-2 px-1.5 py-0.5 text-[10px] text-ink-3">
            {scopeLabel}
          </span>
        </div>
        {showActions && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {memory.status === "draft" && (
              <button
                type="button"
                onClick={() => actions.updateMemory(memory.id, { status: "approved" })}
                className="rounded p-1 text-ink-3 hover:bg-muted hover:text-emerald-700"
                title="Approve"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" onClick={() => void copy()} className="rounded p-1 text-ink-3 hover:bg-muted" title="Copy">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={togglePin}
              className={cn("rounded p-1 hover:bg-muted", memory.status === "pinned" ? "text-accent" : "text-ink-3")}
              title={memory.status === "pinned" ? "Unpin" : "Pin"}
            >
              {memory.status === "pinned" ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>

      <h3 className="mt-2 text-[13px] font-semibold leading-snug text-ink">{memory.title}</h3>

      {preview && (
        <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-ink-2">{preview}</p>
      )}

      {memory.tags && memory.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {memory.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-ink-3">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border-2 pt-2 text-[10px] text-ink-3">
        {sourceLabel && canJumpSource && (
          <button
            type="button"
            onClick={() => jumpFromMemory(memory)}
            className="inline-flex items-center gap-0.5 font-medium text-accent hover:text-accent-d"
          >
            <ExternalLink className="h-3 w-3" />
            {sourceLabel}
          </button>
        )}
        {sourceLabel && !canJumpSource && <span>{sourceLabel}</span>}
        {suggestedBy && <span>Suggested by {suggestedBy}</span>}
        <span>Saved by {savedBy}</span>
        <span className="ml-auto">{timeAgo(memory.updatedAt ?? memory.createdAt)}</span>
      </div>
    </article>
  );
}
