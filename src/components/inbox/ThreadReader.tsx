"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArchiveRestore,
  MailOpen,
  ShieldAlert,
  ShieldCheck,
  Reply,
  Loader2,
  Paperclip,
  AlertTriangle,
  Sparkles,
  X,
  UserPlus,
  Bot,
  Users,
} from "lucide-react";
import type { MailboxAccessFlags, MessageDTO, ThreadDetailDTO } from "@/lib/inbox/types";
import { cn } from "@/lib/utils";
import { EmailWorkPanel } from "@/components/inbox/EmailWorkPanel";

const DELIVERY_LABEL: Record<string, string> = {
  received: "Received",
  queued: "Queued",
  sending: "Sending…",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Marked spam",
  failed: "Not delivered",
  cancelled: "Cancelled",
};

type AssignDraft =
  | { kind: "none" }
  | { kind: "human"; id: string }
  | { kind: "ai_employee"; id: string };

export type AssignSavePayload = {
  humanId?: string | null;
  employeeId?: string | null;
  clear?: boolean;
  label: string | null;
  kind: "human" | "ai_employee" | null;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function deliveryHelp(status: string, error: string | null): string | null {
  if (error) return error;
  if (status === "bounced") {
    return "This message bounced. The address may be incorrect or the mailbox unreachable.";
  }
  if (status === "failed") {
    return "This message could not be delivered. Check the address and try again.";
  }
  if (status === "complained") {
    return "The recipient marked this message as spam.";
  }
  if (status === "sending" || status === "queued") {
    return "Sending… You can undo from the banner at the bottom while it is still pending.";
  }
  return null;
}

function draftFromThread(thread: ThreadDetailDTO): AssignDraft {
  if (!thread.assigneeId) return { kind: "none" };
  if (thread.assigneeKind === "human") return { kind: "human", id: thread.assigneeId };
  if (thread.assigneeKind === "ai_employee") {
    return { kind: "ai_employee", id: thread.assigneeId };
  }
  return { kind: "ai_employee", id: thread.assigneeId };
}

function draftsEqual(a: AssignDraft, b: AssignDraft): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "none" || b.kind === "none") return true;
  return a.id === b.id;
}

function MessageBubble({
  message,
  onOpenAttachment,
}: {
  message: MessageDTO;
  onOpenAttachment?: (attachmentId: string) => void;
}) {
  const outbound = message.direction === "outbound";
  const internal = message.direction === "internal";
  const deliveryBad = ["bounced", "failed", "complained"].includes(message.deliveryStatus);
  const deliveryPending = ["queued", "sending"].includes(message.deliveryStatus);
  const help = outbound ? deliveryHelp(message.deliveryStatus, message.deliveryError) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "border-b border-border-2 px-5 py-4 last:border-b-0",
        internal && "bg-amber-50/40",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-ink">
            {internal
              ? "Internal note"
              : message.fromName || message.fromAddress || (outbound ? "You" : "Unknown")}
          </span>
          {!internal && message.fromAddress && (
            <span className="ml-2 truncate text-xs text-ink-3">{message.fromAddress}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-ink-3">
          {outbound && (
            <span
              className={cn(
                deliveryBad && "font-medium text-rose-600",
                deliveryPending && "text-amber-700",
              )}
            >
              {DELIVERY_LABEL[message.deliveryStatus] ?? message.deliveryStatus}
            </span>
          )}
          <span>{formatTime(message.createdAt)}</span>
        </div>
      </div>
      {!internal && (
        <div className="text-xs text-ink-3">
          To: {message.to.join(", ") || "—"}
          {message.cc.length > 0 && <span> · Cc: {message.cc.join(", ")}</span>}
        </div>
      )}

      {help && (deliveryBad || deliveryPending) && (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
            deliveryBad
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-amber-200 bg-amber-50 text-amber-900",
          )}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{help}</span>
        </div>
      )}

      {message.htmlSanitised && !internal ? (
        <div
          className="prose prose-sm mt-3 max-w-none text-ink"
          dangerouslySetInnerHTML={{ __html: message.htmlSanitised }}
        />
      ) : (
        <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-ink">
          {message.textBody || ""}
        </pre>
      )}

      {message.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpenAttachment?.(a.id)}
              className="inline-flex items-center gap-1.5 rounded border border-border bg-muted px-2 py-1 text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink"
            >
              <Paperclip className="h-3 w-3" />
              {a.filename || "Attachment"}
              {a.quarantineState !== "clean" && (
                <span className="text-amber-700">({a.quarantineState})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

type ReaderTab = "messages" | "internal" | "context";

function ToolbarButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-2 transition-colors hover:bg-muted hover:text-ink active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

export function ThreadReader({
  thread,
  loading,
  access,
  workspaceMembers,
  aiEmployees,
  currentUserId,
  onReply,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onToggleSpam,
  onDraftWithAi,
  onDismissSuggestion,
  onAssignSuggested,
  onSaveAssign,
  onCancelDraft,
  onRetryDraft,
  onOpenLatestDraft,
  onAddInternalNote,
  onOpenAttachment,
  onClose,
  drafting,
  workspaceId,
}: {
  thread: ThreadDetailDTO | null;
  loading: boolean;
  access: MailboxAccessFlags;
  workspaceId?: string;
  workspaceMembers?: Array<{ id: string; name: string }>;
  aiEmployees?: Array<{ id: string; name: string; role?: string }>;
  currentUserId?: string | null;
  onReply: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkUnread: () => void;
  onToggleSpam: () => void;
  onDraftWithAi?: () => void;
  onDismissSuggestion?: () => void;
  onAssignSuggested?: () => void;
  onSaveAssign?: (payload: AssignSavePayload) => Promise<void> | void;
  onCancelDraft?: () => void;
  onRetryDraft?: () => void;
  onOpenLatestDraft?: () => void;
  onAddInternalNote?: (text: string) => Promise<void> | void;
  onOpenAttachment?: (attachmentId: string) => void;
  onClose?: () => void;
  drafting?: boolean;
}) {
  const archived = thread?.status === "archived";
  const isSpam = thread?.isSpam ?? false;
  const [assignBusy, setAssignBusy] = useState(false);
  const [tab, setTab] = useState<ReaderTab>("messages");
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [assignDraft, setAssignDraft] = useState<AssignDraft>({ kind: "none" });
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!thread) {
      setAssignDraft({ kind: "none" });
      return;
    }
    setAssignDraft(draftFromThread(thread));
    setTab("messages");
    setSavedFlash(false);
  }, [thread?.id]);

  useEffect(() => {
    if (!thread) return;
    // Sync draft when server assignee changes (e.g. after successful save/reload).
    setAssignDraft(draftFromThread(thread));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.assigneeId, thread?.assigneeKind]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const committedDraft = thread ? draftFromThread(thread) : { kind: "none" as const };
  const assignDirty = !draftsEqual(assignDraft, committedDraft);

  const showNextStep =
    thread &&
    !thread.suggestionDismissed &&
    thread.assistanceModeSuggestsActions &&
    thread.replyRequired &&
    thread.draftStatus !== "queued" &&
    thread.draftStatus !== "running";

  const suggestedOwnerAssignable =
    Boolean(thread?.suggestedEmployeeId) &&
    (aiEmployees ?? []).some((e) => e.id === thread?.suggestedEmployeeId);

  const showSuggestOwner =
    thread &&
    suggestedOwnerAssignable &&
    thread.suggestedEmployeeId !== thread.assigneeId &&
    thread.assignmentSource !== "human";

  const customerMessages = useMemo(
    () => (thread?.messages ?? []).filter((m) => m.direction !== "internal"),
    [thread],
  );
  const internalMessages = useMemo(
    () => (thread?.messages ?? []).filter((m) => m.direction === "internal"),
    [thread],
  );

  const selectValue =
    assignDraft.kind === "none"
      ? "none"
      : assignDraft.kind === "human"
        ? `human:${assignDraft.id}`
        : `ai:${assignDraft.id}`;

  const resolveLabel = (draft: AssignDraft): string | null => {
    if (draft.kind === "none") return null;
    if (draft.kind === "human") {
      const m = (workspaceMembers ?? []).find((x) => x.id === draft.id);
      return m?.name ?? "Teammate";
    }
    const e = (aiEmployees ?? []).find((x) => x.id === draft.id);
    return e?.name ?? "AI employee";
  };

  const handleSaveAssign = async () => {
    if (!onSaveAssign || !assignDirty) return;
    setAssignBusy(true);
    try {
      const label = resolveLabel(assignDraft);
      if (assignDraft.kind === "none") {
        await onSaveAssign({ clear: true, label: null, kind: null });
      } else if (assignDraft.kind === "human") {
        await onSaveAssign({
          humanId: assignDraft.id,
          label,
          kind: "human",
        });
      } else {
        await onSaveAssign({
          employeeId: assignDraft.id,
          label,
          kind: "ai_employee",
        });
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save assignment";
      window.alert(msg);
    } finally {
      setAssignBusy(false);
    }
  };

  if (loading && !thread) {
    return (
      <div className="flex h-full items-center justify-center text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft/80 text-accent-d">
          <MailOpen className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-ink">No conversation open</p>
        <p className="max-w-xs text-xs text-ink-3">
          Pick a thread from the list, or keep browsing folders — you can close any open email anytime.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      key={thread.id}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex items-center gap-1 border-b border-border bg-surface/95 px-2 py-1.5 backdrop-blur-sm">
        {access.canSend && (
          <ToolbarButton onClick={onReply}>
            <Reply className="h-4 w-4" /> Reply
          </ToolbarButton>
        )}
        {access.canRead && (
          <ToolbarButton onClick={onMarkUnread}>
            <MailOpen className="h-4 w-4" /> Mark unread
          </ToolbarButton>
        )}
        {access.canOrganize && (
          <>
            <ToolbarButton onClick={archived ? onUnarchive : onArchive}>
              {archived ? (
                <>
                  <ArchiveRestore className="h-4 w-4" /> Unarchive
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" /> Archive
                </>
              )}
            </ToolbarButton>
            <ToolbarButton onClick={onToggleSpam}>
              {isSpam ? (
                <>
                  <ShieldCheck className="h-4 w-4" /> Not spam
                </>
              ) : (
                <>
                  <ShieldAlert className="h-4 w-4" /> Spam
                </>
              )}
            </ToolbarButton>
          </>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-muted hover:text-ink"
            aria-label="Close conversation"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="border-b border-border px-5 py-3">
        <h2 className="truncate text-base font-semibold tracking-tight text-ink">
          {thread.subject}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          {thread.category && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 capitalize">{thread.category}</span>
          )}
          {thread.priority !== "normal" && (
            <span className="rounded-md bg-amber-50 px-1.5 py-0.5 capitalize text-amber-800">
              {thread.priority}
            </span>
          )}
          {thread.assigneeName && (
            <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-accent-d">
              {thread.assigneeKind === "ai_employee" ? (
                <Bot className="h-3 w-3" />
              ) : (
                <Users className="h-3 w-3" />
              )}
              {thread.assigneeName}
            </span>
          )}
          {thread.hasUnread && <span className="font-medium text-accent-d">Unread</span>}
          {(thread.triageStatus === "queued" || thread.triageStatus === "running") && (
            <span className="flex items-center gap-1 text-accent-d">
              <Loader2 className="h-3 w-3 animate-spin" /> Organising…
            </span>
          )}
          {(thread.draftStatus === "queued" || thread.draftStatus === "running") && (
            <span className="flex items-center gap-1 text-accent-d">
              <Loader2 className="h-3 w-3 animate-spin" /> Drafting…
              {onCancelDraft && (
                <button
                  type="button"
                  onClick={onCancelDraft}
                  className="ml-1 underline hover:text-ink"
                >
                  Cancel
                </button>
              )}
            </span>
          )}
          {thread.draftStatus === "failed" && onRetryDraft && (
            <button
              type="button"
              onClick={onRetryDraft}
              className="text-rose-700 underline hover:text-rose-800"
            >
              Draft failed — retry
            </button>
          )}
          {thread.latestDraftId && thread.draftStatus === "ready" && onOpenLatestDraft && (
            <button
              type="button"
              onClick={onOpenLatestDraft}
              className="text-accent-d underline hover:text-ink"
            >
              Open AI draft
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-border px-3">
        {(
          [
            ["messages", "Messages"],
            ["internal", `Internal${internalMessages.length ? ` (${internalMessages.length})` : ""}`],
            ["context", "Context"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "relative px-3 py-2 text-xs font-medium transition-colors",
              tab === key ? "text-accent-d" : "text-ink-3 hover:text-ink",
            )}
          >
            {label}
            {tab === key && (
              <motion.span
                layoutId="inbox-reader-tab"
                className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
          </button>
        ))}
      </div>

      {tab === "context" && (
        <div className="border-b border-border bg-muted/40 px-5 py-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            What matters
          </p>
          {thread.triageStatus === "queued" || thread.triageStatus === "running" ? (
            <p className="text-sm text-ink-2">Organising this email…</p>
          ) : thread.triageStatus === "failed" ? (
            <p className="text-sm text-rose-700">
              Triage failed — the email is still available in your inbox.
            </p>
          ) : thread.keyPoints.length === 0 && !thread.summary ? (
            <p className="text-sm text-ink-3">No steward signals yet.</p>
          ) : (
            <>
              <ul className="space-y-1 text-sm text-ink-2">
                {thread.keyPoints.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span className="text-ink-3">·</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              {thread.summary && (
                <p className="mt-2 text-sm text-ink-2">{thread.summary}</p>
              )}
            </>
          )}
        </div>
      )}

      {showSuggestOwner && tab === "messages" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft/30 px-5 py-3">
          <UserPlus className="h-4 w-4 text-accent-d" />
          <span className="min-w-0 flex-1 text-sm text-ink">
            Suggested owner:{" "}
            <span className="font-medium">
              {thread.suggestedEmployeeName || "AI employee"}
            </span>
            {thread.matchReason ? (
              <span className="text-ink-3"> — {thread.matchReason}</span>
            ) : null}
          </span>
          {access.canOrganize && onAssignSuggested && (
            <button
              type="button"
              disabled={assignBusy}
              onClick={() => {
                setAssignBusy(true);
                Promise.resolve(onAssignSuggested()).finally(() => setAssignBusy(false));
              }}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Assign
            </button>
          )}
          {onDismissSuggestion && (
            <button
              type="button"
              onClick={onDismissSuggestion}
              className="rounded-md p-1.5 text-ink-3 transition hover:bg-muted hover:text-ink"
              aria-label="Dismiss suggestion"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {access.canOrganize && onSaveAssign && tab === "messages" && (
        <div className="border-b border-border bg-surface px-5 py-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1">
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                <Users className="h-3 w-3" /> Assign
              </span>
              <select
                className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                value={selectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "none") {
                    setAssignDraft({ kind: "none" });
                    return;
                  }
                  if (v.startsWith("human:")) {
                    setAssignDraft({ kind: "human", id: v.slice("human:".length) });
                    return;
                  }
                  if (v.startsWith("ai:")) {
                    setAssignDraft({ kind: "ai_employee", id: v.slice("ai:".length) });
                  }
                }}
              >
                <option value="none">Unassigned</option>
                {(workspaceMembers ?? []).length > 0 && (
                  <optgroup label="Teammates">
                    {(workspaceMembers ?? []).map((m) => (
                      <option key={m.id} value={`human:${m.id}`}>
                        {m.name}
                        {m.id === currentUserId ? " (you)" : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(aiEmployees ?? []).length > 0 && (
                  <optgroup label="AI employees">
                    {(aiEmployees ?? []).map((e) => (
                      <option key={e.id} value={`ai:${e.id}`}>
                        {e.name}
                        {e.role ? ` · ${e.role}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <div className="flex items-center gap-1.5 pb-0.5">
              <button
                type="button"
                disabled={!assignDirty || assignBusy}
                onClick={() => void handleSaveAssign()}
                className={cn(
                  "rounded-lg px-3 py-2 text-xs font-semibold transition",
                  assignDirty
                    ? "bg-accent text-white shadow-sm hover:opacity-90"
                    : "bg-muted text-ink-3",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {assignBusy ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
                  </span>
                ) : (
                  "Save"
                )}
              </button>
              <button
                type="button"
                disabled={!assignDirty || assignBusy}
                onClick={() => setAssignDraft(committedDraft)}
                className="rounded-lg px-3 py-2 text-xs font-medium text-ink-2 transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
          <AnimatePresence>
            {(assignDirty || savedFlash) && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-1.5 overflow-hidden text-[11px] text-ink-3"
              >
                {savedFlash
                  ? "Assignment saved."
                  : "Changes aren’t applied until you save — you can cancel if this was a mistake."}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}

      {showNextStep && tab === "messages" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft/50 px-5 py-3">
          <Sparkles className="h-4 w-4 text-accent-d" />
          <span className="min-w-0 flex-1 text-sm text-ink">
            {thread.suggestedNextAction || "Draft a reply when ready"}
          </span>
          {access.canSend && onDraftWithAi && (
            <button
              type="button"
              disabled={drafting}
              onClick={onDraftWithAi}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Draft with AI
            </button>
          )}
          {onDismissSuggestion && (
            <button
              type="button"
              onClick={onDismissSuggestion}
              className="rounded-md p-1.5 text-ink-3 transition hover:bg-muted hover:text-ink"
              aria-label="Dismiss suggestion"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {tab === "messages" && (
            <motion.div
              key="messages"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {customerMessages.map((m) => (
                <MessageBubble key={m.id} message={m} onOpenAttachment={onOpenAttachment} />
              ))}
            </motion.div>
          )}
          {tab === "internal" && (
            <motion.div
              key="internal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {internalMessages.length === 0 && (
                <p className="p-6 text-center text-sm text-ink-3">
                  No internal notes yet. Notes stay inside the workspace.
                </p>
              )}
              {internalMessages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {access.canSend && onAddInternalNote && (
                <div className="border-t border-border p-4">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={3}
                    placeholder="Add an internal note…"
                    className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  />
                  <button
                    type="button"
                    disabled={noteBusy || !noteText.trim()}
                    onClick={() => {
                      const text = noteText.trim();
                      if (!text) return;
                      setNoteBusy(true);
                      Promise.resolve(onAddInternalNote(text))
                        .then(() => setNoteText(""))
                        .finally(() => setNoteBusy(false));
                    }}
                    className="mt-2 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    {noteBusy ? "Saving…" : "Add note"}
                  </button>
                </div>
              )}
            </motion.div>
          )}
          {tab === "context" && (
            <motion.div
              key="context"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="space-y-2 border-b border-border px-5 py-3 text-sm text-ink-2">
                <p>
                  <span className="text-ink-3">Category:</span> {thread.category || "—"}
                </p>
                <p>
                  <span className="text-ink-3">Priority:</span> {thread.priority}
                </p>
                <p>
                  <span className="text-ink-3">Reply required:</span>{" "}
                  {thread.replyRequired ? "Yes" : "No"}
                </p>
                {thread.matchReason && (
                  <p>
                    <span className="text-ink-3">Why selected:</span> {thread.matchReason}
                  </p>
                )}
              </div>
              {workspaceId ? (
                <EmailWorkPanel
                  workspaceId={workspaceId}
                  threadId={thread.id}
                  canOrganize={access.canOrganize}
                  defaultTaskTitle={thread.subject}
                />
              ) : (
                <p className="p-5 text-sm text-ink-3">Workspace unavailable.</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
