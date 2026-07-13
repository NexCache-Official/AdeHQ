"use client";

import { useMemo } from "react";
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

      <div className="mt-3 max-w-none overflow-x-auto text-sm leading-relaxed text-ink-2">
        {message.htmlSanitised ? (
          <div
            className="email-html [&_a]:text-accent-d [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: message.htmlSanitised }}
          />
        ) : (
          <pre className="whitespace-pre-wrap font-sans">{message.textBody || "(no content)"}</pre>
        )}
      </div>

      {message.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <span
              key={a.id}
              className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs text-ink-2"
            >
              <Paperclip className="h-3 w-3" /> {a.filename || "attachment"}
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
}: {
  thread: ThreadDetailDTO | null;
  loading: boolean;
  access: MailboxAccessFlags;
  onReply: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMarkUnread: () => void;
  onToggleSpam: () => void;
}) {
  const archived = thread?.status === "archived";
  const isSpam = thread?.isSpam ?? false;

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
        {thread.hasUnread && (
          <p className="mt-0.5 text-xs text-accent-d">Unread — opening marks this as read</p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {thread.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}
