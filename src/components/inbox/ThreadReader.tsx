"use client";

import { useMemo, useState } from "react";
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
} from "lucide-react";
import type { MailboxAccessFlags, MessageDTO, ThreadDetailDTO } from "@/lib/inbox/types";
import { cn } from "@/lib/utils";

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

function MessageBubble({ message }: { message: MessageDTO }) {
  const outbound = message.direction === "outbound";
  const deliveryBad = ["bounced", "failed", "complained"].includes(message.deliveryStatus);
  const deliveryPending = ["queued", "sending"].includes(message.deliveryStatus);
  const help = outbound ? deliveryHelp(message.deliveryStatus, message.deliveryError) : null;

  return (
    <div className="border-b border-border-2 px-5 py-4 last:border-b-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-ink">
            {message.fromName || message.fromAddress || (outbound ? "You" : "Unknown")}
          </span>
          {message.fromAddress && (
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
      <div className="text-xs text-ink-3">
        To: {message.to.join(", ") || "—"}
        {message.cc.length > 0 && <span> · Cc: {message.cc.join(", ")}</span>}
      </div>

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

      {message.htmlSanitised ? (
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
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded border border-border bg-muted px-2 py-1 text-xs text-ink-2"
            >
              <Paperclip className="h-3 w-3" />
              {a.filename || "Attachment"}
              {a.quarantineState !== "clean" && (
                <span className="text-amber-700">({a.quarantineState})</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ThreadReader({
  thread,
  loading,
  access,
  onReply,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onToggleSpam,
  onDraftWithAi,
  onDismissSuggestion,
  onAssignSuggested,
  onClearAssignee,
  onCancelDraft,
  onRetryDraft,
  onOpenLatestDraft,
  drafting,
}: {
  thread: ThreadDetailDTO | null;
  loading: boolean;
  access: MailboxAccessFlags;
  onReply: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkUnread: () => void;
  onToggleSpam: () => void;
  onDraftWithAi?: () => void;
  onDismissSuggestion?: () => void;
  onAssignSuggested?: () => void;
  onClearAssignee?: () => void;
  onCancelDraft?: () => void;
  onRetryDraft?: () => void;
  onOpenLatestDraft?: () => void;
  drafting?: boolean;
}) {
  const archived = thread?.status === "archived";
  const isSpam = thread?.isSpam ?? false;
  const [assignBusy, setAssignBusy] = useState(false);

  const showNextStep =
    thread &&
    !thread.suggestionDismissed &&
    thread.assistanceModeSuggestsActions &&
    thread.replyRequired &&
    thread.draftStatus !== "queued" &&
    thread.draftStatus !== "running";

  const showSuggestOwner =
    thread &&
    thread.suggestedEmployeeId &&
    thread.suggestedEmployeeId !== thread.assigneeId &&
    thread.assignmentSource !== "human";

  const showWhatMatters =
    thread &&
    (thread.keyPoints.length > 0 ||
      thread.summary ||
      thread.triageStatus === "queued" ||
      thread.triageStatus === "running" ||
      thread.triageStatus === "failed");

  const toolbar = useMemo(
    () => (
      <div className="flex items-center gap-1 border-b border-border bg-surface px-3 py-2">
        {access.canSend && (
          <button
            type="button"
            onClick={onReply}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-muted"
          >
            <Reply className="h-4 w-4" /> Reply
          </button>
        )}
        {access.canRead && (
          <button
            type="button"
            onClick={onMarkUnread}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-muted"
          >
            <MailOpen className="h-4 w-4" /> Mark unread
          </button>
        )}
        {access.canOrganize && (
          <>
            <button
              type="button"
              onClick={archived ? onUnarchive : onArchive}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-muted"
            >
              {archived ? (
                <>
                  <ArchiveRestore className="h-4 w-4" /> Unarchive
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" /> Archive
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onToggleSpam}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-muted"
            >
              {isSpam ? (
                <>
                  <ShieldCheck className="h-4 w-4" /> Not spam
                </>
              ) : (
                <>
                  <ShieldAlert className="h-4 w-4" /> Spam
                </>
              )}
            </button>
          </>
        )}
      </div>
    ),
    [access, archived, isSpam, onReply, onArchive, onUnarchive, onMarkUnread, onToggleSpam],
  );

  if (loading && !thread) {
    return (
      <div className="flex h-full items-center justify-center text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-3">
        Select a conversation to read it.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      <div className="border-b border-border px-5 py-3">
        <h2 className="truncate text-base font-semibold text-ink">{thread.subject}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          {thread.category && (
            <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{thread.category}</span>
          )}
          {thread.priority !== "normal" && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 capitalize text-amber-800">
              {thread.priority}
            </span>
          )}
          {thread.assigneeName && (
            <span className="rounded bg-muted px-1.5 py-0.5">
              Assigned to {thread.assigneeName}
            </span>
          )}
          {thread.hasUnread && <span className="text-accent-d">Unread</span>}
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

      {showWhatMatters && (
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

      {showSuggestOwner && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
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
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Assign
            </button>
          )}
          {onDismissSuggestion && (
            <button
              type="button"
              onClick={onDismissSuggestion}
              className="rounded-md p-1.5 text-ink-3 hover:bg-muted hover:text-ink"
              aria-label="Dismiss suggestion"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {thread.assigneeId && access.canOrganize && onClearAssignee && (
        <div className="flex items-center gap-2 border-b border-border px-5 py-2 text-xs text-ink-3">
          <span>
            Assigned to {thread.assigneeName || "employee"} (assignment does not start drafting)
          </span>
          <button type="button" onClick={onClearAssignee} className="underline hover:text-ink">
            Clear
          </button>
        </div>
      )}

      {showNextStep && (
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
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              Draft with AI
            </button>
          )}
          {onDismissSuggestion && (
            <button
              type="button"
              onClick={onDismissSuggestion}
              className="rounded-md p-1.5 text-ink-3 hover:bg-muted hover:text-ink"
              aria-label="Dismiss suggestion"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {thread.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}
