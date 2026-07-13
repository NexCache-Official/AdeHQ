"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Inbox as InboxIcon,
  Send as SendIcon,
  FileText,
  Clock,
  Archive,
  ShieldAlert,
  Loader2,
  PenSquare,
  ChevronLeft,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/demo-store";
import {
  fetchMailbox,
  fetchThreads,
  fetchThread,
  fetchDrafts,
  sendEmailReq,
  threadAction,
} from "@/lib/inbox/client";
import { useInboxRealtime } from "@/lib/inbox/use-inbox-realtime";
import { ClaimGate } from "@/components/inbox/ClaimGate";
import { ThreadReader } from "@/components/inbox/ThreadReader";
import { Composer, type ComposerInitial, type SendPayload } from "@/components/inbox/Composer";
import type {
  DraftDTO,
  InboxFolder,
  InboxMailboxResponse,
  MailboxAccessFlags,
  MessageDTO,
  ThreadDetailDTO,
  ThreadSummaryDTO,
} from "@/lib/inbox/types";

const FOLDERS: { key: InboxFolder; label: string; icon: typeof InboxIcon }[] = [
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "awaiting", label: "Awaiting reply", icon: Clock },
  { key: "sent", label: "Sent", icon: SendIcon },
  { key: "drafts", label: "Drafts", icon: FileText },
  { key: "archived", label: "Archived", icon: Archive },
  { key: "spam", label: "Spam", icon: ShieldAlert },
];

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function InboxPage() {
  const { state } = useStore();
  const workspaceId = state.workspace.id;
  const workspaceName = state.workspace.name || "Workspace";

  const [mailbox, setMailbox] = useState<InboxMailboxResponse | null>(null);
  const [mailboxError, setMailboxError] = useState<string | null>(null);

  const [folder, setFolder] = useState<InboxFolder>("inbox");
  const [threads, setThreads] = useState<ThreadSummaryDTO[]>([]);
  const [drafts, setDrafts] = useState<DraftDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<ThreadDetailDTO | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);

  const [composer, setComposer] = useState<{ open: boolean; initial: ComposerInitial }>({
    open: false,
    initial: {},
  });
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const access: MailboxAccessFlags | null =
    mailbox && mailbox.claimed ? mailbox.access : null;
  const mailboxId = mailbox && mailbox.claimed ? mailbox.mailbox.id : null;

  // --- Mailbox lookup -------------------------------------------------------
  const loadMailbox = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetchMailbox(workspaceId);
      setMailbox(res);
      setMailboxError(null);
    } catch (err) {
      setMailboxError(err instanceof Error ? err.message : "Failed to load inbox.");
    }
  }, [workspaceId]);

  useEffect(() => {
    setMailbox(null);
    void loadMailbox();
  }, [loadMailbox]);

  // --- Folder loading -------------------------------------------------------
  const loadFolder = useCallback(
    async (target: InboxFolder, opts?: { silent?: boolean }) => {
      if (!workspaceId || !access?.canRead) return;
      if (!opts?.silent) setLoadingList(true);
      try {
        if (target === "drafts") {
          const list = await fetchDrafts(workspaceId);
          setDrafts(list);
          setThreads([]);
          setNextCursor(null);
        } else {
          const page = await fetchThreads({ workspaceId, folder: target, limit: 30 });
          setThreads(page.threads);
          setNextCursor(page.nextCursor);
          setDrafts([]);
        }
      } finally {
        if (!opts?.silent) setLoadingList(false);
      }
    },
    [workspaceId, access?.canRead],
  );

  useEffect(() => {
    if (access?.canRead) void loadFolder(folder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, access?.canRead, mailboxId]);

  const loadMore = useCallback(async () => {
    if (!workspaceId || !nextCursor || folder === "drafts") return;
    const page = await fetchThreads({ workspaceId, folder, cursor: nextCursor, limit: 30 });
    setThreads((prev) => {
      const seen = new Set(prev.map((t) => t.id));
      return [...prev, ...page.threads.filter((t) => !seen.has(t.id))];
    });
    setNextCursor(page.nextCursor);
  }, [workspaceId, nextCursor, folder]);

  // --- Thread open ----------------------------------------------------------
  const openThread = useCallback(
    async (threadId: string) => {
      if (!workspaceId) return;
      setSelectedThreadId(threadId);
      setMobileView("thread");
      setLoadingThread(true);
      try {
        const detail = await fetchThread({ workspaceId, threadId });
        setThreadDetail(detail);
        // Optimistically clear unread in the list.
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, hasUnread: false } : t)),
        );
        void threadAction({ workspaceId, threadId, action: "read" }).catch(() => {});
      } finally {
        setLoadingThread(false);
      }
    },
    [workspaceId],
  );

  // --- Realtime (patch, not full reload) ------------------------------------
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(
    (affectedThreadId: string | null) => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        void loadFolder(folder, { silent: true });
        if (affectedThreadId && affectedThreadId === selectedThreadId && workspaceId) {
          void fetchThread({ workspaceId, threadId: affectedThreadId })
            .then(setThreadDetail)
            .catch(() => {});
        }
      }, 350);
    },
    [folder, selectedThreadId, workspaceId, loadFolder],
  );

  useInboxRealtime({
    workspaceId,
    enabled: Boolean(access?.canRead),
    onEvent: (event) => {
      // Permission changes are handled by re-checking the mailbox.
      scheduleRefresh(event.threadId);
    },
  });

  // --- Sending (optimistic) -------------------------------------------------
  const handleSend = useCallback(
    async (payload: SendPayload) => {
      if (!workspaceId) return;
      const targetThreadId = payload.threadId;

      // Optimistic bubble in the open thread.
      const optimistic: MessageDTO = {
        id: `optimistic-${payload.clientSendId}`,
        direction: "outbound",
        fromAddress: mailbox && mailbox.claimed ? mailbox.mailbox.address : null,
        fromName: null,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject: payload.subject,
        textBody: payload.body,
        htmlSanitised: null,
        deliveryStatus: "sending",
        createdAt: new Date().toISOString(),
        attachments: [],
      };
      if (targetThreadId && selectedThreadId === targetThreadId) {
        setThreadDetail((prev) =>
          prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev,
        );
      }

      try {
        const result = await sendEmailReq({
          workspaceId,
          clientSendId: payload.clientSendId,
          draftId: payload.draftId,
          threadId: payload.threadId,
          to: payload.to,
          cc: payload.cc,
          bcc: payload.bcc,
          subject: payload.subject,
          body: payload.body,
        });
        // Reconcile: reload the affected thread (or open the new one).
        const finalThreadId = result.threadId ?? targetThreadId;
        if (finalThreadId) {
          const detail = await fetchThread({ workspaceId, threadId: finalThreadId });
          if (selectedThreadId === finalThreadId || !selectedThreadId) {
            setSelectedThreadId(finalThreadId);
            setThreadDetail(detail);
          }
        }
      } catch {
        // Mark the optimistic bubble as failed so the user can retry.
        setThreadDetail((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === optimistic.id ? { ...m, deliveryStatus: "failed" } : m,
                ),
              }
            : prev,
        );
      } finally {
        void loadFolder(folder, { silent: true });
      }
    },
    [workspaceId, mailbox, selectedThreadId, folder, loadFolder],
  );

  const startReply = useCallback(() => {
    if (!threadDetail) return;
    const lastInbound = [...threadDetail.messages]
      .reverse()
      .find((m) => m.direction === "inbound");
    const to = lastInbound?.fromAddress ? [lastInbound.fromAddress] : [];
    const subject = threadDetail.subject.match(/^re:/i)
      ? threadDetail.subject
      : `Re: ${threadDetail.subject}`;
    setComposer({ open: true, initial: { threadId: threadDetail.id, to, subject } });
  }, [threadDetail]);

  const runThreadAction = useCallback(
    async (action: "archive" | "unarchive" | "unread" | "spam", spam?: boolean) => {
      if (!workspaceId || !selectedThreadId) return;
      await threadAction({ workspaceId, threadId: selectedThreadId, action, spam }).catch(() => {});
      await loadFolder(folder, { silent: true });
      if (action === "unread" || action === "archive" || action === "spam") {
        setSelectedThreadId(null);
        setThreadDetail(null);
        setMobileView("list");
      }
    },
    [workspaceId, selectedThreadId, folder, loadFolder],
  );

  // --- Render gates ---------------------------------------------------------
  if (!workspaceId) {
    return <CenterMessage text="Loading workspace…" spinner />;
  }
  if (mailboxError) {
    return <CenterMessage text={mailboxError} />;
  }
  if (!mailbox) {
    return <CenterMessage text="Loading inbox…" spinner />;
  }
  if (!mailbox.claimed) {
    return (
      <ClaimGate
        workspaceId={workspaceId}
        canClaim={mailbox.canClaim}
        defaultDisplayName={workspaceName}
        onClaimed={loadMailbox}
      />
    );
  }
  if (!mailbox.access.canRead) {
    return (
      <CenterMessage text="You don't have access to this workspace's inbox. Ask an admin for access." />
    );
  }

  const listItems = folder === "drafts" ? drafts : threads;

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      {/* Folders */}
      <nav className="hidden w-52 shrink-0 flex-col border-r border-border bg-surface px-2 py-3 md:flex">
        <div className="px-2 pb-3">
          <button
            onClick={() => setComposer({ open: true, initial: {} })}
            disabled={!mailbox.access.canSend}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            <PenSquare className="h-4 w-4" /> Compose
          </button>
        </div>
        <p className="truncate px-3 pb-2 text-xs text-ink-3">{mailbox.mailbox.address}</p>
        {FOLDERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFolder(f.key);
              setSelectedThreadId(null);
              setThreadDetail(null);
            }}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 transition hover:bg-muted",
              folder === f.key && "bg-accent-soft font-medium text-accent-d hover:bg-accent-soft",
            )}
          >
            <f.icon className="h-4 w-4" />
            {f.label}
          </button>
        ))}
      </nav>

      {/* Thread list */}
      <div
        className={cn(
          "flex min-h-0 w-full flex-col border-r border-border md:w-80 md:shrink-0",
          mobileView === "thread" && "hidden md:flex",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold capitalize text-ink">
            {FOLDERS.find((f) => f.key === folder)?.label}
          </h1>
          {loadingList && <Loader2 className="h-4 w-4 animate-spin text-ink-3" />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listItems.length === 0 && !loadingList && (
            <p className="p-6 text-center text-sm text-ink-3">Nothing here yet.</p>
          )}
          {folder === "drafts"
            ? drafts.map((d) => (
                <DraftRow
                  key={d.id}
                  draft={d}
                  onClick={() =>
                    setComposer({
                      open: true,
                      initial: {
                        draftId: d.id,
                        threadId: d.threadId,
                        to: d.to,
                        cc: d.cc,
                        bcc: d.bcc,
                        subject: d.subject,
                        body: d.textBody ?? "",
                      },
                    })
                  }
                />
              ))
            : threads.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  active={t.id === selectedThreadId}
                  onClick={() => openThread(t.id)}
                />
              ))}
          {nextCursor && folder !== "drafts" && (
            <button
              onClick={loadMore}
              className="w-full py-3 text-center text-xs text-ink-3 hover:text-ink"
            >
              Load more
            </button>
          )}
        </div>
      </div>

      {/* Reader / composer */}
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          mobileView === "list" && "hidden md:flex",
        )}
      >
        <button
          onClick={() => setMobileView("list")}
          className="flex items-center gap-1 border-b border-border px-4 py-2 text-sm text-ink-2 md:hidden"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ThreadReader
            thread={threadDetail}
            loading={loadingThread}
            access={mailbox.access}
            onReply={startReply}
            onArchive={() => runThreadAction("archive")}
            onUnarchive={() => runThreadAction("unarchive")}
            onMarkUnread={() => runThreadAction("unread")}
            onToggleSpam={() => runThreadAction("spam", !threadDetail?.isSpam)}
          />
        </div>
        {composer.open && (
          <Composer
            workspaceId={workspaceId}
            initial={composer.initial}
            onSend={handleSend}
            onClose={() => {
              setComposer({ open: false, initial: {} });
              if (folder === "drafts") void loadFolder("drafts", { silent: true });
            }}
            onDraftChange={() => {
              if (folder === "drafts") void loadFolder("drafts", { silent: true });
            }}
          />
        )}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  onClick,
}: {
  thread: ThreadSummaryDTO;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-0.5 border-b border-border-2 px-4 py-3 text-left transition hover:bg-muted",
        active && "bg-accent-soft hover:bg-accent-soft",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-sm text-ink-2",
            thread.hasUnread && "font-semibold text-ink",
          )}
        >
          {thread.senderName || thread.sender || "Unknown"}
        </span>
        <span className="shrink-0 text-xs text-ink-3">{relativeTime(thread.timestamp)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {thread.hasUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
        <span
          className={cn("truncate text-sm text-ink-2", thread.hasUnread && "font-medium text-ink")}
        >
          {thread.subject}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {thread.hasAttachments && <Paperclip className="h-3 w-3 shrink-0 text-ink-3" />}
        <span className="truncate text-xs text-ink-3">{thread.snippet}</span>
      </div>
    </button>
  );
}

function DraftRow({ draft, onClick }: { draft: DraftDTO; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col gap-0.5 border-b border-border-2 px-4 py-3 text-left transition hover:bg-muted"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-ink-2">
          {draft.to.length > 0 ? draft.to.join(", ") : "(no recipient)"}
        </span>
        <span className="shrink-0 text-xs text-ink-3">{relativeTime(draft.updatedAt)}</span>
      </div>
      <span className="truncate text-sm text-ink">{draft.subject || "(no subject)"}</span>
      <span className="truncate text-xs text-ink-3">{draft.textBody || ""}</span>
    </button>
  );
}

function CenterMessage({ text, spinner }: { text: string; spinner?: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-3">
      <div className="flex items-center gap-2">
        {spinner && <Loader2 className="h-4 w-4 animate-spin" />}
        {text}
      </div>
    </div>
  );
}
