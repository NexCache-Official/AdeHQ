"use client";

import { useMemo, useState } from "react";
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
import { MEMORY_CATEGORIES, normalizeCategory } from "@/lib/memory/categories";
import {
  archiveMemoryClient,
  deleteMemoryClient,
  patchMemoryClient,
} from "@/lib/memory/client";
import { jumpFromMemory } from "@/lib/navigation/jump-to-source";
import { cn, timeAgo } from "@/lib/utils";
import { Button, Modal, ModalHeader } from "@/components/ui";
import {
  Archive,
  Check,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

const STATUS_STYLES: Record<MemoryEntry["status"], string> = {
  draft: "bg-muted text-ink-3",
  approved: "bg-emerald-500/12 text-emerald-700",
  pinned: "bg-accent-500/12 text-accent-d",
  superseded: "bg-muted text-ink-3 line-through",
  archived: "bg-amber-500/10 text-amber-800",
};

type MemoryCardProps = {
  memory: MemoryEntry;
  compact?: boolean;
  showActions?: boolean;
  onUpdated?: (memory: MemoryEntry) => void;
  onArchived?: (memoryId: string) => void;
};

export function MemoryCard({
  memory,
  compact = false,
  showActions = true,
  onUpdated,
  onArchived,
}: MemoryCardProps) {
  const { state, actions, backend } = useStore();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(memory.title);
  const [editContent, setEditContent] = useState(memory.content);
  const [editCategory, setEditCategory] = useState(normalizeCategory(memory.category));

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

  const applyUpdate = (updated: MemoryEntry) => {
    actions.mergeMemoryEntry(updated);
    onUpdated?.(updated);
  };

  const togglePin = async () => {
    const next = memory.status === "pinned" ? "approved" : "pinned";
    if (backend === "supabase") {
      try {
        const updated = await patchMemoryClient(memory.id, { status: next });
        applyUpdate(updated);
      } catch {
        actions.updateMemory(memory.id, { status: next });
      }
    } else {
      actions.updateMemory(memory.id, { status: next });
    }
  };

  const archive = async () => {
    setBusy(true);
    setError(null);
    try {
      if (backend === "supabase") {
        const updated = await archiveMemoryClient(memory.id);
        applyUpdate(updated);
      } else {
        actions.updateMemory(memory.id, { status: "archived", updatedAt: new Date().toISOString() });
      }
      onArchived?.(memory.id);
      setMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive memory.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      if (backend === "supabase") {
        const updated = await deleteMemoryClient(memory.id);
        applyUpdate(updated);
      } else {
        actions.updateMemory(memory.id, {
          status: "archived",
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      onArchived?.(memory.id);
      setConfirmDelete(false);
      setMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete memory.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    setBusy(true);
    setError(null);
    try {
      const patch = {
        title: editTitle.trim(),
        content: editContent.trim(),
        category: editCategory,
      };
      if (backend === "supabase") {
        const updated = await patchMemoryClient(memory.id, patch);
        applyUpdate(updated);
      } else {
        actions.updateMemory(memory.id, { ...patch, updatedAt: new Date().toISOString() });
      }
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(`${memory.title}\n\n${preview || memory.content}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <article
        className={cn(
          "group relative rounded-xl border border-border bg-surface transition-colors hover:border-border-2",
          compact ? "p-3" : "p-3.5",
          memory.status === "pinned" && "border-accent/30 bg-accent-soft/20",
          memory.status === "archived" && "opacity-80",
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
            <div className="relative flex shrink-0 items-center gap-0.5">
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
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded p-1 text-ink-3 hover:bg-muted"
                title="Actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-7 z-20 min-w-[148px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted" onClick={() => { setEditOpen(true); setMenuOpen(false); }}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted" onClick={() => void copy()}>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </button>
                  {canJumpSource && (
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted" onClick={() => { jumpFromMemory(memory); setMenuOpen(false); }}>
                      <ExternalLink className="h-3.5 w-3.5" /> Jump to source
                    </button>
                  )}
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted" onClick={() => void togglePin()}>
                    {memory.status === "pinned" ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    {memory.status === "pinned" ? "Unpin" : "Pin"}
                  </button>
                  <button type="button" disabled={busy} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted" onClick={() => void archive()}>
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </button>
                  <button type="button" disabled={busy} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50" onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              )}
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
        {error && <p className="mt-2 text-[10px] text-red-600">{error}</p>}
        {confirmDelete && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2">
            <p className="text-[11px] text-red-800">Delete this memory? This soft-deletes it from active lists.</p>
            <div className="mt-2 flex gap-2">
              <Button variant="danger" size="sm" disabled={busy} onClick={() => void remove()}>Delete</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border-2 pt-2 text-[10px] text-ink-3">
          {sourceLabel && canJumpSource && (
            <button type="button" onClick={() => jumpFromMemory(memory)} className="inline-flex items-center gap-0.5 font-medium text-accent hover:text-accent-d">
              <ExternalLink className="h-3 w-3" />
              {sourceLabel}
            </button>
          )}
          {sourceLabel && !canJumpSource && <span>{sourceLabel}</span>}
          {suggestedBy && <span>Suggested by {suggestedBy}</span>}
          <span>Saved by {savedBy}</span>
          <span className="ml-auto">{copied ? "Copied" : timeAgo(memory.updatedAt ?? memory.createdAt)}</span>
        </div>
      </article>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} size="md">
        <ModalHeader title="Edit memory" onClose={() => setEditOpen(false)} icon={<Pencil className="h-5 w-5" />} />
        <div className="space-y-3 p-5">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-3">Title</span>
            <input className="input-field" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-3">Content</span>
            <textarea className="input-field min-h-[100px]" value={editContent} onChange={(e) => setEditContent(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-3">Category</span>
            <select className="input-field" value={editCategory} onChange={(e) => setEditCategory(e.target.value as typeof editCategory)}>
              {MEMORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button onClick={() => void saveEdit()} disabled={busy || !editTitle.trim()}>Save</Button>
        </div>
      </Modal>
    </>
  );
}
