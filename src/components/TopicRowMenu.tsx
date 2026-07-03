"use client";

import { useState } from "react";
import type { AIEmployee, RoomTopic } from "@/lib/types";
import { MoreHorizontal, Pencil, Archive, Trash2 } from "lucide-react";

export function TopicRowMenu({
  topic,
  onRename,
  onArchive,
  onDelete,
  busy = false,
}: {
  topic: RoomTopic;
  onRename?: (topic: RoomTopic, newTitle: string) => Promise<void>;
  onArchive?: (topic: RoomTopic) => Promise<void>;
  onDelete?: (topic: RoomTopic) => Promise<void>;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (renaming) {
    return (
      <form
        className="flex items-center gap-1 px-1"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!title.trim() || busy) return;
          void onRename?.(topic, title.trim()).finally(() => setRenaming(false));
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="h-7 min-w-0 flex-1 rounded border border-border bg-canvas px-2 text-xs"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <button type="submit" className="text-[10px] font-medium text-accent" disabled={busy}>
          Save
        </button>
        <button type="button" className="text-[10px] text-ink-3" onClick={() => setRenaming(false)}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="rounded p-0.5 text-ink-3 opacity-0 transition group-hover/topicrow:opacity-100 hover:bg-muted"
        onClick={() => setOpen((v) => !v)}
        aria-label="Topic actions"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-5 z-30 min-w-[130px] rounded-lg border border-border bg-surface py-1 shadow-lg">
          {onRename && (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-muted"
              onClick={() => { setRenaming(true); setOpen(false); }}
            >
              <Pencil className="h-3 w-3" /> Rename
            </button>
          )}
          {onArchive && (
            <button
              type="button"
              disabled={busy}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-muted"
              onClick={() => void onArchive(topic).finally(() => setOpen(false))}
            >
              <Archive className="h-3 w-3" /> Archive
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-red-600 hover:bg-red-50"
              onClick={() => { setConfirmDelete(true); setOpen(false); }}
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          )}
        </div>
      )}
      {confirmDelete && (
        <div
          className="absolute right-0 top-5 z-40 w-48 rounded-lg border border-red-200 bg-red-50 p-2 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] text-red-800">Delete &quot;{topic.title}&quot; permanently?</p>
          <div className="mt-2 flex gap-1">
            <button
              type="button"
              disabled={busy}
              className="rounded bg-red-600 px-2 py-1 text-[10px] text-white"
              onClick={() => void onDelete?.(topic).finally(() => setConfirmDelete(false))}
            >
              Delete
            </button>
            <button type="button" className="px-2 py-1 text-[10px]" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
