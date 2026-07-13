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
} from "lucide-react";
import type { MailboxAccessFlags, MessageDTO, ThreadDetailDTO } from "@/lib/inbox/types";

const DELIVERY_LABEL: Record<string, string> = {
  received: "Received",
  queued: "Queued",
  sending: "Sending…",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Marked spam",
  failed: "Failed",
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

function MessageBubble({ message }: { message: MessageDTO }) {
  const outbound = message.direction === "outbound";
  const deliveryBad = ["bounced", "failed", "complained"].includes(message.deliveryStatus);
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
            <span className={deliveryBad ? "text-rose-600" : "text-ink-3"}>
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

      <div className="mt-3 max-w-none overflow-x-auto text-sm leading-relaxed text-ink-2">
        {message.htmlSanitised ? (
          <div
            className="email-html [&_a]:text-accent-d [&_a]:underline"
            // Sanitised at ingest (src/lib/inbox/sanitize.ts): remote images
            // stripped, scripts/handlers removed. Rendered in a plain div (no
            // app-shell styles leak in).
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
            onClick={onReply}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-muted"
          >
            <Reply className="h-4 w-4" /> Reply
          </button>
        )}
        {access.canOrganize && (
          <>
            <button
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
              onClick={onMarkUnread}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-muted"
            >
              <MailOpen className="h-4 w-4" /> Mark unread
            </button>
            <button
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
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {thread.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}
