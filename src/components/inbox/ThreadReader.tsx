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
import { EMAIL_MISSION_LABELS } from "@/lib/inbox/mission-status";
import { InboxMissionPill } from "@/components/inbox/InboxMissionPill";

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
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
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
  const displayName = internal
    ? "Internal note"
    : message.fromName || message.fromAddress || (outbound ? "You" : "Unknown");
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "border-t border-border pt-[22px] first:border-t-0 first:pt-0",
        internal && "rounded-xl bg-amber-soft/40 px-3 py-3",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] text-[11px] font-semibold text-white",
            outbound ? "bg-ink" : "bg-[rgb(117_113_109)]",
          )}
        >
          {outbound ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5L4.2 16.5" />
            </svg>
          ) : (
            initials || "?"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-2">
              <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
                {displayName}
              </span>
              {!internal && message.fromAddress && (
                <span className="truncate font-mono text-[12.5px] text-ink-3">
                  {message.fromAddress}
                </span>
              )}
            </div>
            <span className="shrink-0 font-mono text-[12px] text-ink-3">
              {outbound && (
                <span
                  className={cn(
                    deliveryBad && "font-medium text-danger",
                    deliveryPending && "text-amber",
                  )}
                >
                  {DELIVERY_LABEL[message.deliveryStatus] ?? message.deliveryStatus}
                  {" · "}
                </span>
              )}
              {formatTime(message.createdAt)}
            </span>
          </div>
          {!internal && (
            <div className="mt-1 text-[12.5px] text-ink-3">
              To: {message.to.join(", ") || "—"}
              {message.cc.length > 0 && <span> · Cc: {message.cc.join(", ")}</span>}
            </div>
          )}

          {help && (deliveryBad || deliveryPending) && (
            <div
              className={cn(
                "mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                deliveryBad
                  ? "border-danger/30 bg-danger-soft text-danger"
                  : "border-amber/30 bg-amber-soft text-amber",
              )}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{help}</span>
            </div>
          )}

          {message.htmlSanitised && !internal ? (
            <div
              className="prose prose-sm mt-[18px] max-w-none text-[15px] leading-[1.7] text-ink"
              dangerouslySetInnerHTML={{ __html: message.htmlSanitised }}
            />
          ) : (
            <pre className="mt-[18px] whitespace-pre-wrap font-sans text-[15px] leading-[1.7] text-ink">
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1 text-xs text-ink-2 transition-colors hover:bg-accent-soft hover:text-ink"
                >
                  <Paperclip className="h-3 w-3" />
                  {a.filename || "Attachment"}
                  {a.quarantineState !== "clean" && (
                    <span className="text-amber">({a.quarantineState})</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
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
      className="flex items-center gap-[7px] rounded-lg px-3 py-[7px] text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted hover:text-ink active:scale-[0.98]"
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
  demoMode = false,
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
  demoMode?: boolean;
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
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-border bg-canvas/80 px-5 backdrop-blur-sm">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="9" y1="4" x2="9" y2="20" />
          </svg>
        </div>
        <div className="flex items-center gap-1">
          {access.canSend && (
            <ToolbarButton onClick={onReply}>
              <Reply className="h-[15px] w-[15px] text-ink-3" /> Reply
            </ToolbarButton>
          )}
          {access.canRead && (
            <ToolbarButton onClick={onMarkUnread}>
              <MailOpen className="h-[15px] w-[15px] text-ink-3" /> Mark unread
            </ToolbarButton>
          )}
          {access.canOrganize && (
            <>
              <ToolbarButton onClick={archived ? onUnarchive : onArchive}>
                {archived ? (
                  <>
                    <ArchiveRestore className="h-[15px] w-[15px] text-ink-3" /> Unarchive
                  </>
                ) : (
                  <>
                    <Archive className="h-[15px] w-[15px] text-ink-3" /> Archive
                  </>
                )}
              </ToolbarButton>
              <ToolbarButton onClick={onToggleSpam}>
                {isSpam ? (
                  <>
                    <ShieldCheck className="h-[15px] w-[15px] text-ink-3" /> Not spam
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-[15px] w-[15px] text-ink-3" /> Spam
                  </>
                )}
              </ToolbarButton>
            </>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-muted hover:text-ink"
              aria-label="Close conversation"
              title="Close"
            >
              <X className="h-4 w-4" strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-10 pb-10 pt-[30px]">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
          {thread.subject}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {thread.missionStatus !== "idle" && (
            <InboxMissionPill status={thread.missionStatus} className="!px-2.5 !py-[3px] !text-[11px]" />
          )}
          {thread.category && (
            <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] capitalize text-ink-3">
              {thread.category}
            </span>
          )}
          {thread.priority !== "normal" && (
            <span className="rounded-md bg-amber-soft px-1.5 py-0.5 text-[11px] capitalize text-amber">
              {thread.priority}
            </span>
          )}
          {thread.assigneeName && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-ink-2">
              {thread.assigneeKind === "ai_employee" ? (
                <Bot className="h-3 w-3" />
              ) : (
                <Users className="h-3 w-3" />
              )}
              {thread.assigneeName}
            </span>
          )}
          {thread.hasUnread && (
            <span className="font-mono text-[11px] font-medium text-ink">Unread</span>
          )}
          {(thread.triageStatus === "queued" || thread.triageStatus === "running") && (
            <span className="flex items-center gap-1 text-[12px] text-ink-3">
              <Loader2 className="h-3 w-3 animate-spin" /> Organising…
            </span>
          )}
          {(thread.draftStatus === "queued" || thread.draftStatus === "running") && (
            <span className="flex items-center gap-1 text-[12px] text-ink-3">
              <Loader2 className="h-3 w-3 animate-spin" /> Drafting…
              {onCancelDraft && (
                <button type="button" onClick={onCancelDraft} className="ml-1 underline hover:text-ink">
                  Cancel
                </button>
              )}
            </span>
          )}
          {thread.draftStatus === "failed" && onRetryDraft && (
            <button type="button" onClick={onRetryDraft} className="text-[12px] text-danger underline">
              Draft failed — retry
            </button>
          )}
          {thread.latestDraftId && thread.draftStatus === "ready" && onOpenLatestDraft && (
            <button type="button" onClick={onOpenLatestDraft} className="text-[12px] text-ink underline">
              Open AI draft
            </button>
          )}
        </div>

      <div className="mt-6 flex gap-6 border-b border-border">
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
              "relative pb-3 text-[13.5px] transition-colors",
              tab === key
                ? "font-semibold text-ink"
                : "font-medium text-ink-3 hover:text-ink",
            )}
          >
            {label}
            {tab === key && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />
            )}
          </button>
        ))}
      </div>

      {tab === "context" && (
        <div className="mt-5 rounded-[10px] border border-border bg-muted/50 px-4 py-3">
          <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">
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

      {showSuggestOwner && tab === "messages" && !demoMode && (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-accent-soft/50 px-4 py-3">
          <UserPlus className="h-4 w-4 text-ink-3" />
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
              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-d disabled:opacity-50"
            >
              Assign
            </button>
          )}
          {onDismissSuggestion && (
            <button
              type="button"
              onClick={onDismissSuggestion}
              className="rounded-lg p-1.5 text-ink-3 transition hover:bg-muted hover:text-ink"
              aria-label="Dismiss suggestion"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {access.canOrganize && onSaveAssign && tab === "messages" && (
        <div className="mt-[22px]">
          <div className="mb-2.5 flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.12em] text-ink-3">
            <Users className="h-[13px] w-[13px]" strokeWidth={2} />
            ASSIGN
          </div>
          <div className="flex gap-2">
            <label className="min-w-0 flex-1">
              <select
                className="w-full appearance-none rounded-[9px] border border-border bg-surface px-3.5 py-[11px] text-[13.5px] text-ink outline-none transition hover:border-[rgb(209_206_203)] focus:border-ink"
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
            <button
              type="button"
              disabled={!assignDirty || assignBusy}
              onClick={() => void handleSaveAssign()}
              className={cn(
                "rounded-[9px] px-[18px] py-[11px] text-[13px] font-semibold transition",
                assignDirty
                  ? "bg-ink text-white hover:bg-accent-d"
                  : "bg-accent-soft text-ink-3",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {assignBusy ? "Saving" : "Save"}
            </button>
            <button
              type="button"
              disabled={!assignDirty || assignBusy}
              onClick={() => setAssignDraft(committedDraft)}
              className="rounded-[9px] px-4 py-[11px] text-[13px] font-medium text-ink-3 transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>
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
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-accent-soft/60 px-4 py-3">
          <Sparkles className="h-4 w-4 text-ink-3" />
          <span className="min-w-0 flex-1 text-sm text-ink">
            {thread.suggestedNextAction || "Draft a reply when ready"}
          </span>
          {access.canSend && onDraftWithAi && !demoMode && (
            <button
              type="button"
              disabled={drafting}
              onClick={onDraftWithAi}
              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-d disabled:opacity-50"
            >
              Draft with AI
            </button>
          )}
          {onDismissSuggestion && (
            <button
              type="button"
              onClick={onDismissSuggestion}
              className="rounded-lg p-1.5 text-ink-3 transition hover:bg-muted hover:text-ink"
              aria-label="Dismiss suggestion"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="mt-7">
        <AnimatePresence mode="wait">
          {tab === "messages" && (
            <motion.div
              key="messages"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-7"
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
                <p className="py-6 text-center text-sm text-ink-3">
                  No internal notes yet. Notes stay inside the workspace.
                </p>
              )}
              <div className="space-y-7">
                {internalMessages.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </div>
              {access.canSend && onAddInternalNote && (
                <div className="mt-6 border-t border-border pt-4">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={3}
                    placeholder="Add an internal note…"
                    className="w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
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
                    className="mt-2 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-d disabled:opacity-40"
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
              <div className="mb-4 space-y-2 rounded-[10px] border border-border bg-surface px-4 py-3 text-sm text-ink-2">
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
              {workspaceId && !demoMode ? (
                <EmailWorkPanel
                  workspaceId={workspaceId}
                  threadId={thread.id}
                  canOrganize={access.canOrganize}
                  defaultTaskTitle={thread.subject}
                />
              ) : (
                <p className="text-sm text-ink-3">
                  {demoMode
                    ? "Work actions are available with a live mailbox."
                    : "Workspace unavailable."}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </div>
      </div>
    </motion.div>
  );
}
