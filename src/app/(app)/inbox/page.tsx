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
  Sparkles,
  CheckCircle2,
  Settings2,
  UserRound,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/demo-store";
import {
  fetchMailbox,
  fetchThreads,
  fetchThread,
  fetchDrafts,
  sendEmailReq,
  cancelSendReq,
  flushOutboxReq,
  threadAction,
  requestAiDraftReq,
  dismissSuggestionReq,
  fetchMailboxSettings,
  updateMailboxSettings,
  assignThreadReq,
  cancelAiDraftReq,
  postInternalNoteReq,
  fetchAttachmentUrl,
  fetchInboxBrief,
  fetchMailboxMembers,
} from "@/lib/inbox/client";
import { useInboxRealtime } from "@/lib/inbox/use-inbox-realtime";
import { ClaimGate } from "@/components/inbox/ClaimGate";
import {
  ThreadReader,
  type AssignSavePayload,
} from "@/components/inbox/ThreadReader";
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
import { motion } from "framer-motion";
import { workAssignableEmployees } from "@/lib/maya-employee";

const FOLDERS: { key: InboxFolder; label: string; icon: typeof InboxIcon }[] = [
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "assigned_to_me", label: "Assigned to me", icon: UserRound },
  { key: "ai_working", label: "AI working", icon: Sparkles },
  { key: "needs_approval", label: "Needs approval", icon: CheckCircle2 },
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
  const [mobileView, setMobileView] = useState<"folders" | "list" | "thread">("list");
  const [undoBanner, setUndoBanner] = useState<{
    outboxId: string;
    undoUntil: string;
    subject: string;
    threadId: string | null;
    optimisticId: string;
  } | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistanceMode, setAssistanceMode] = useState<string>("ai_triage");
  const [brief, setBrief] = useState<{
    greeting: string;
    stats: { unread: number; needsApproval: number; highPriority: number; assignedToMe: number };
  } | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<
    Array<{ id: string; name: string; email: string | null; role: string }>
  >([]);

  const access: MailboxAccessFlags | null =
    mailbox && mailbox.claimed ? mailbox.access : null;
  const mailboxId = mailbox && mailbox.claimed ? mailbox.mailbox.id : null;

  // Per-folder cache so Inbox ↔ Sent switches stay instant and never flash empty
  // from a slower in-flight response for a different folder.
  type FolderCache = {
    threads: ThreadSummaryDTO[];
    nextCursor: string | null;
    drafts: DraftDTO[];
  };
  const folderCacheRef = useRef<Partial<Record<InboxFolder, FolderCache>>>({});
  const folderLoadSeqRef = useRef<Partial<Record<InboxFolder, number>>>({});
  const folderRef = useRef(folder);
  folderRef.current = folder;

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
    folderCacheRef.current = {};
    setThreads([]);
    setDrafts([]);
    setNextCursor(null);
    void loadMailbox();
  }, [loadMailbox]);

  // --- Folder loading -------------------------------------------------------
  const applyFolderToUi = useCallback((target: InboxFolder, cached: FolderCache) => {
    if (target === "drafts") {
      setDrafts(cached.drafts);
      setThreads([]);
      setNextCursor(null);
    } else {
      setThreads(cached.threads);
      setNextCursor(cached.nextCursor);
      setDrafts([]);
    }
  }, []);

  const loadFolder = useCallback(
    async (target: InboxFolder, opts?: { silent?: boolean }) => {
      if (!workspaceId || !access?.canRead) return;

      const seq = (folderLoadSeqRef.current[target] ?? 0) + 1;
      folderLoadSeqRef.current[target] = seq;

      const cached = folderCacheRef.current[target];
      if (!opts?.silent && folderRef.current === target) {
        if (cached) {
          applyFolderToUi(target, cached);
        } else {
          setLoadingList(true);
        }
      }

      try {
        let next: FolderCache;
        if (target === "drafts") {
          const list = await fetchDrafts(workspaceId);
          next = { threads: [], nextCursor: null, drafts: list };
        } else {
          const page = await fetchThreads({ workspaceId, folder: target, limit: 30 });
          next = {
            threads: page.threads,
            nextCursor: page.nextCursor,
            drafts: [],
          };
        }

        // Ignore superseded fetches for this folder.
        if (folderLoadSeqRef.current[target] !== seq) return;

        folderCacheRef.current[target] = next;

        // Only paint if the user is still viewing this folder.
        if (folderRef.current === target) {
          applyFolderToUi(target, next);
        }
      } catch {
        // Keep cached rows visible on transient errors.
      } finally {
        if (!opts?.silent && folderRef.current === target) {
          setLoadingList(false);
        }
      }
    },
    [workspaceId, access?.canRead, applyFolderToUi],
  );

  useEffect(() => {
    if (!access?.canRead) return;
    const cached = folderCacheRef.current[folder];
    if (cached) {
      applyFolderToUi(folder, cached);
    } else if (folder === "drafts") {
      setDrafts([]);
      setThreads([]);
      setNextCursor(null);
    } else {
      // Avoid painting another folder's rows under this label while loading.
      setThreads([]);
      setDrafts([]);
      setNextCursor(null);
    }
    void loadFolder(folder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, access?.canRead, mailboxId]);

  const loadMore = useCallback(async () => {
    if (!workspaceId || !nextCursor || folder === "drafts") return;
    const target = folder;
    const seq = folderLoadSeqRef.current[target] ?? 0;
    const page = await fetchThreads({
      workspaceId,
      folder: target,
      cursor: nextCursor,
      limit: 30,
    });
    if (folderLoadSeqRef.current[target] !== seq || folderRef.current !== target) return;

    setThreads((prev) => {
      const seen = new Set(prev.map((t) => t.id));
      const merged = [...prev, ...page.threads.filter((t) => !seen.has(t.id))];
      folderCacheRef.current[target] = {
        threads: merged,
        nextCursor: page.nextCursor,
        drafts: [],
      };
      return merged;
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
        setThreadDetail({ ...detail, hasUnread: false });
        // Optimistically clear unread in the list + cache.
        setThreads((prev) => {
          const next = prev.map((t) => (t.id === threadId ? { ...t, hasUnread: false } : t));
          const cached = folderCacheRef.current[folderRef.current];
          if (cached && folderRef.current !== "drafts") {
            folderCacheRef.current[folderRef.current] = { ...cached, threads: next };
          }
          return next;
        });
        void threadAction({ workspaceId, threadId, action: "read" }).catch(() => {});
      } finally {
        setLoadingThread(false);
      }
    },
    [workspaceId],
  );

  // --- Realtime (debounced silent refresh of current folder + open thread) --
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(
    (affectedThreadId: string | null) => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        const current = folderRef.current;
        // Keep the visible folder's cache for stable UI; drop others so the
        // next visit refetches after inbound/outbound changes.
        const keep = folderCacheRef.current[current];
        folderCacheRef.current = keep ? { [current]: keep } : {};
        void loadFolder(current, { silent: true });
        if (affectedThreadId && affectedThreadId === selectedThreadId && workspaceId) {
          void fetchThread({ workspaceId, threadId: affectedThreadId })
            .then(setThreadDetail)
            .catch(() => {});
        }
      }, 250);
    },
    [selectedThreadId, workspaceId, loadFolder],
  );

  useInboxRealtime({
    workspaceId,
    enabled: Boolean(access?.canRead),
    onEvent: (event) => {
      scheduleRefresh(event.threadId);
    },
  });

  // --- Sending (optimistic + undo window) -----------------------------------
  const clearUndoBanner = useCallback(() => {
    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoBanner(null);
    setUndoSecondsLeft(0);
  }, []);

  useEffect(() => {
    if (!undoBanner) return;
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil((new Date(undoBanner.undoUntil).getTime() - Date.now()) / 1000),
      );
      setUndoSecondsLeft(left);
      if (left <= 0) {
        if (undoTimerRef.current) {
          clearInterval(undoTimerRef.current);
          undoTimerRef.current = null;
        }
        const banner = undoBanner;
        setUndoBanner(null);
        setUndoSecondsLeft(0);
        void (async () => {
          try {
            await flushOutboxReq({
              workspaceId: workspaceId!,
              outboxId: banner.outboxId,
              force: true,
            });
          } catch {
            /* cron / another tab may have flushed */
          }
          if (workspaceId && banner.threadId) {
            void fetchThread({ workspaceId, threadId: banner.threadId })
              .then(setThreadDetail)
              .catch(() => {});
          }
          folderCacheRef.current = {};
          void loadFolder(folderRef.current, { silent: true });
        })();
      }
    };
    tick();
    undoTimerRef.current = setInterval(tick, 250);
    return () => {
      if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    };
  }, [undoBanner, clearUndoBanner, workspaceId, loadFolder]);

  const handleUndoSend = useCallback(async () => {
    if (!workspaceId || !undoBanner) return;
    const banner = undoBanner;
    clearUndoBanner();
    try {
      await cancelSendReq({ workspaceId, outboxId: banner.outboxId });
      setThreadDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.filter((m) => m.id !== banner.optimisticId),
            }
          : prev,
      );
      folderCacheRef.current = {};
      void loadFolder(folderRef.current, { silent: true });
    } catch {
      // Already sent — refresh so the user sees the real status.
      if (banner.threadId) {
        void fetchThread({ workspaceId, threadId: banner.threadId })
          .then(setThreadDetail)
          .catch(() => {});
      }
      folderCacheRef.current = {};
      void loadFolder(folderRef.current, { silent: true });
    }
  }, [workspaceId, undoBanner, clearUndoBanner, loadFolder]);

  const handleSend = useCallback(
    async (payload: SendPayload) => {
      if (!workspaceId) return;
      const targetThreadId = payload.threadId;
      const optimisticId = `optimistic-${payload.clientSendId}`;

      const optimistic: MessageDTO = {
        id: optimisticId,
        direction: "outbound",
        fromAddress: mailbox && mailbox.claimed ? mailbox.mailbox.address : null,
        fromName: null,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject: payload.subject,
        textBody: payload.body,
        htmlSanitised: payload.htmlBody || null,
        deliveryStatus: "sending",
        deliveryError: null,
        outboxId: null,
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
          htmlBody: payload.htmlBody,
          attachments: payload.attachments,
        });

        const finalThreadId = result.threadId ?? targetThreadId;
        setThreadDetail((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === optimisticId
                    ? {
                        ...m,
                        outboxId: result.outboxId,
                        deliveryStatus:
                          result.status === "queued" || result.status === "sending"
                            ? "sending"
                            : ((result.status as MessageDTO["deliveryStatus"]) ?? "sending"),
                      }
                    : m,
                ),
              }
            : prev,
        );

        if (result.undoUntil && result.status === "queued") {
          setUndoBanner({
            outboxId: result.outboxId,
            undoUntil: result.undoUntil,
            subject: payload.subject || "(no subject)",
            threadId: finalThreadId,
            optimisticId,
          });
        } else if (finalThreadId) {
          const detail = await fetchThread({ workspaceId, threadId: finalThreadId });
          if (selectedThreadId === finalThreadId || !selectedThreadId) {
            setSelectedThreadId(finalThreadId);
            setThreadDetail(detail);
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Send failed.";
        setThreadDetail((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === optimisticId
                    ? { ...m, deliveryStatus: "failed", deliveryError: reason }
                    : m,
                ),
              }
            : prev,
        );
      } finally {
        folderCacheRef.current = {};
        void loadFolder(folderRef.current, { silent: true });
      }
    },
    [workspaceId, mailbox, selectedThreadId, loadFolder],
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

  const handleDraftWithAi = useCallback(async () => {
    if (!workspaceId || !selectedThreadId) return;
    setDrafting(true);
    try {
      await requestAiDraftReq({
        workspaceId,
        threadId: selectedThreadId,
        employeeId: threadDetail?.assigneeId || threadDetail?.suggestedEmployeeId || undefined,
      });
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const detail = await fetchThread({ workspaceId, threadId: selectedThreadId });
        setThreadDetail(detail);
        if (detail.draftStatus === "ready" && detail.latestDraftId) {
          const list = await fetchDrafts(workspaceId);
          setDrafts(list);
          const draft = list.find((d) => d.id === detail.latestDraftId);
          if (draft) {
            setComposer({
              open: true,
              initial: {
                draftId: draft.id,
                threadId: draft.threadId,
                to: draft.to,
                cc: draft.cc,
                bcc: draft.bcc,
                subject: draft.subject,
                body: draft.textBody ?? "",
                htmlBody: draft.htmlBody ?? undefined,
                originType: draft.originType,
                requiresApproval: draft.requiresApproval,
                isStale: draft.isStale,
                staleReason: draft.staleReason,
                approvalStatus: draft.approvalStatus,
                approvalId: draft.approvalId,
                approvalExpiresAt: draft.approvalExpiresAt,
                employeeId: draft.employeeId,
                mailboxAddress: mailbox?.claimed ? mailbox.mailbox.address : undefined,
                canApprove: mailbox?.claimed ? mailbox.access.canApprove : false,
              },
            });
          }
          break;
        }
        if (detail.draftStatus === "failed" || detail.draftStatus === "cancelled") break;
      }
    } catch {
      /* surfaced via draft_status */
    } finally {
      setDrafting(false);
      folderCacheRef.current = {};
      void loadFolder(folderRef.current, { silent: true });
    }
  }, [workspaceId, selectedThreadId, threadDetail, loadFolder, mailbox]);

  const handleAssignSuggested = useCallback(async () => {
    if (!workspaceId || !selectedThreadId || !threadDetail?.suggestedEmployeeId) return;
    const employeeId = threadDetail.suggestedEmployeeId;
    const label = threadDetail.suggestedEmployeeName;
    setThreadDetail((prev) =>
      prev
        ? {
            ...prev,
            assigneeId: employeeId,
            assigneeKind: "ai_employee",
            assigneeName: label,
            assignmentSource: "human",
          }
        : prev,
    );
    await assignThreadReq({
      workspaceId,
      threadId: selectedThreadId,
      employeeId,
    }).catch(() => {});
    const detail = await fetchThread({ workspaceId, threadId: selectedThreadId }).catch(() => null);
    if (detail) setThreadDetail(detail);
  }, [workspaceId, selectedThreadId, threadDetail]);

  const handleSaveAssign = useCallback(
    async (payload: AssignSavePayload) => {
      if (!workspaceId || !selectedThreadId) return;
      setThreadDetail((prev) =>
        prev
          ? {
              ...prev,
              assigneeId: payload.clear ? null : payload.humanId ?? payload.employeeId ?? null,
              assigneeKind: payload.kind,
              assigneeName: payload.label,
              assignmentSource: "human",
            }
          : prev,
      );
      await assignThreadReq({
        workspaceId,
        threadId: selectedThreadId,
        humanId: payload.humanId,
        employeeId: payload.employeeId,
        clear: payload.clear,
      }).catch(() => {});
      void fetchThread({ workspaceId, threadId: selectedThreadId })
        .then((detail) => {
          if (detail) setThreadDetail(detail);
        })
        .catch(() => {});
    },
    [workspaceId, selectedThreadId],
  );

  const closeThread = useCallback(() => {
    setSelectedThreadId(null);
    setThreadDetail(null);
    setMobileView("list");
  }, []);

  const handleCancelDraft = useCallback(async () => {
    if (!workspaceId || !selectedThreadId) return;
    await cancelAiDraftReq({ workspaceId, threadId: selectedThreadId }).catch(() => {});
    const detail = await fetchThread({ workspaceId, threadId: selectedThreadId }).catch(() => null);
    if (detail) setThreadDetail(detail);
  }, [workspaceId, selectedThreadId]);

  const handleOpenLatestDraft = useCallback(async () => {
    if (!workspaceId || !threadDetail?.latestDraftId || !mailbox?.claimed) return;
    const list = await fetchDrafts(workspaceId).catch(() => [] as DraftDTO[]);
    setDrafts(list);
    const draft = list.find((d) => d.id === threadDetail.latestDraftId);
    if (!draft) return;
    setComposer({
      open: true,
      initial: {
        draftId: draft.id,
        threadId: draft.threadId,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.textBody ?? "",
        htmlBody: draft.htmlBody ?? undefined,
        originType: draft.originType,
        requiresApproval: draft.requiresApproval,
        isStale: draft.isStale,
        staleReason: draft.staleReason,
        approvalStatus: draft.approvalStatus,
        approvalId: draft.approvalId,
        approvalExpiresAt: draft.approvalExpiresAt,
        employeeId: draft.employeeId,
        mailboxAddress: mailbox.mailbox.address,
        canApprove: mailbox.access.canApprove,
      },
    });
  }, [workspaceId, threadDetail, mailbox]);

  const handleDismissSuggestion = useCallback(async () => {
    if (!workspaceId || !selectedThreadId) return;
    await dismissSuggestionReq({ workspaceId, threadId: selectedThreadId }).catch(() => {});
    const detail = await fetchThread({ workspaceId, threadId: selectedThreadId }).catch(() => null);
    if (detail) setThreadDetail(detail);
  }, [workspaceId, selectedThreadId]);

  const handleAddInternalNote = useCallback(
    async (text: string) => {
      if (!workspaceId || !selectedThreadId) return;
      await postInternalNoteReq({ workspaceId, threadId: selectedThreadId, text });
      const detail = await fetchThread({ workspaceId, threadId: selectedThreadId }).catch(() => null);
      if (detail) setThreadDetail(detail);
    },
    [workspaceId, selectedThreadId],
  );

  const handleOpenAttachment = useCallback(
    async (attachmentId: string) => {
      if (!workspaceId) return;
      try {
        const { url } = await fetchAttachmentUrl({ workspaceId, attachmentId });
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* ignore */
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!workspaceId || !mailbox || !mailbox.claimed) return;
    void fetchMailboxSettings(workspaceId)
      .then((s) => setAssistanceMode(s.assistanceMode))
      .catch(() => {});
    void fetchInboxBrief(workspaceId)
      .then((b) => setBrief({ greeting: b.greeting, stats: b.stats }))
      .catch(() => {});
    void fetchMailboxMembers(workspaceId)
      .then(setWorkspaceMembers)
      .catch(() => {});
  }, [workspaceId, mailbox]);

  const runThreadAction = useCallback(
    async (action: "archive" | "unarchive" | "unread" | "spam", spam?: boolean) => {
      if (!workspaceId || !selectedThreadId) return;
      const threadId = selectedThreadId;
      if (action === "unread") {
        setThreads((prev) =>
          prev.map((t) => (t.id === threadId ? { ...t, hasUnread: true } : t)),
        );
      }
      await threadAction({ workspaceId, threadId, action, spam }).catch(() => {});
      folderCacheRef.current = {};
      await loadFolder(folderRef.current, { silent: true });
      if (action === "unread" || action === "archive" || action === "spam") {
        setSelectedThreadId(null);
        setThreadDetail(null);
        setMobileView("list");
      }
    },
    [workspaceId, selectedThreadId, loadFolder],
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
    <div className="relative flex h-full min-h-0 bg-canvas">
      {/* Folders — desktop always; mobile when mobileView=folders */}
      <nav
        className={cn(
          "w-full shrink-0 flex-col border-r border-border bg-surface px-2 py-3 md:flex md:w-52",
          mobileView === "folders" ? "flex" : "hidden",
        )}
      >
        <div className="px-2 pb-3">
          <button
            onClick={() => setComposer({ open: true, initial: {} })}
            disabled={!mailbox.access.canSend}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            <PenSquare className="h-4 w-4" /> Compose
          </button>
        </div>
        {brief && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-2 mb-3 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-accent-soft/80 via-canvas to-canvas px-3 py-3 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
          >
            <div
              className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rounded-full bg-accent/10 blur-2xl"
              aria-hidden
            />
            <p className="relative text-[13px] font-semibold tracking-tight text-ink">
              {brief.greeting}
            </p>
            <p className="relative mt-0.5 text-[10px] text-ink-3">Your inbox pulse</p>
            <div className="relative mt-2.5 grid grid-cols-2 gap-1.5">
              {(
                [
                  { label: "New", value: brief.stats.unread },
                  { label: "Approval", value: brief.stats.needsApproval },
                  { label: "High", value: brief.stats.highPriority },
                  { label: "Assigned", value: brief.stats.assignedToMe },
                ] as const
              ).map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-border/70 bg-surface/80 px-2 py-1.5 backdrop-blur-sm"
                >
                  <p
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      stat.value > 0 ? "text-accent-d" : "text-ink-2",
                    )}
                  >
                    {stat.value}
                  </p>
                  <p className="text-[10px] text-ink-3">{stat.label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
        <p className="truncate px-3 pb-2 text-xs text-ink-3">{mailbox.mailbox.address}</p>
        {FOLDERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFolder(f.key);
              setMobileView("list");
            }}
            className={cn(
              "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-2 transition hover:bg-muted",
              folder === f.key && "bg-accent-soft font-medium text-accent-d hover:bg-accent-soft",
            )}
          >
            <f.icon className="h-4 w-4" />
            {f.label}
          </button>
        ))}
        {mailbox.access.canManage && (
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="mt-auto flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-3 hover:bg-muted hover:text-ink"
          >
            <Settings2 className="h-4 w-4" /> AI settings
          </button>
        )}
        {settingsOpen && mailbox.access.canManage && (
          <div className="mx-2 mt-1 space-y-1 rounded-lg border border-border bg-canvas p-2 text-xs">
            {(
              [
                ["manual", "Off"],
                ["ai_triage", "Organise inbox"],
                ["ai_triage_suggested_replies", "Organise and suggest actions"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setAssistanceMode(mode);
                  void updateMailboxSettings({ workspaceId, assistanceMode: mode });
                }}
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left",
                  assistanceMode === mode ? "bg-accent-soft text-accent-d" : "hover:bg-muted",
                )}
              >
                {label}
              </button>
            ))}
            <p className="px-2 pb-1 pt-1 text-[10px] leading-snug text-ink-3">
              AdeHQ will classify and prioritise incoming email. It will not generate or send
              replies unless you request it.
            </p>
          </div>
        )}
      </nav>

      {/* Thread list */}
      <div
        className={cn(
          "flex min-h-0 w-full flex-col border-r border-border md:w-80 md:shrink-0",
          mobileView !== "list" && "hidden md:flex",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileView("folders")}
              className="rounded p-1 text-ink-3 hover:bg-muted md:hidden"
              aria-label="Folders"
            >
              <Folder className="h-4 w-4" />
            </button>
            <h1 className="text-sm font-semibold capitalize text-ink">
              {FOLDERS.find((f) => f.key === folder)?.label}
            </h1>
          </div>
          {loadingList && <Loader2 className="h-4 w-4 animate-spin text-ink-3" />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listItems.length === 0 && loadingList && (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-ink-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
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
                        htmlBody: d.htmlBody ?? undefined,
                        originType: d.originType,
                        requiresApproval: d.requiresApproval,
                        isStale: d.isStale,
                        staleReason: d.staleReason,
                        approvalStatus: d.approvalStatus,
                        approvalId: d.approvalId,
                        approvalExpiresAt: d.approvalExpiresAt,
                        employeeId: d.employeeId,
                        mailboxAddress: mailbox.mailbox.address,
                        canApprove: mailbox.access.canApprove,
                      },
                    })
                  }
                />
              ))
            : threads.map((t, index) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  folder={folder}
                  active={t.id === selectedThreadId}
                  index={index}
                  onClick={() => openThread(t.id)}
                />
              ))}
          {nextCursor && folder !== "drafts" && (
            <button
              onClick={loadMore}
              className="w-full py-3 text-center text-xs text-ink-3 transition hover:text-ink"
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
          mobileView !== "thread" && "hidden md:flex",
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
            workspaceMembers={workspaceMembers}
            aiEmployees={workAssignableEmployees(state.employees).map((e) => ({
              id: e.id,
              name: e.name,
              role: e.role,
            }))}
            currentUserId={state.user?.id ?? null}
            onReply={startReply}
            onArchive={() => runThreadAction("archive")}
            onUnarchive={() => runThreadAction("unarchive")}
            onMarkUnread={() => runThreadAction("unread")}
            onToggleSpam={() => runThreadAction("spam", !threadDetail?.isSpam)}
            onDraftWithAi={() => void handleDraftWithAi()}
            onDismissSuggestion={() => void handleDismissSuggestion()}
            onAssignSuggested={() => void handleAssignSuggested()}
            onSaveAssign={(payload) => handleSaveAssign(payload)}
            onCancelDraft={() => void handleCancelDraft()}
            onRetryDraft={() => void handleDraftWithAi()}
            onOpenLatestDraft={() => void handleOpenLatestDraft()}
            onAddInternalNote={(text) => handleAddInternalNote(text)}
            onOpenAttachment={(id) => void handleOpenAttachment(id)}
            onClose={closeThread}
            drafting={drafting}
          />
        </div>
        {composer.open && (
          <Composer
            workspaceId={workspaceId}
            initial={{
              ...composer.initial,
              mailboxAddress: mailbox.mailbox.address,
              canApprove: mailbox.access.canApprove,
            }}
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

      {undoBanner && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-lg items-center gap-3 rounded-lg bg-ink px-4 py-3 text-sm text-white shadow-lg">
            <span className="min-w-0 flex-1 truncate">
              Sending “{undoBanner.subject}”… {undoSecondsLeft}s
            </span>
            <button
              type="button"
              onClick={() => void handleUndoSend()}
              className="shrink-0 rounded-md bg-white/15 px-3 py-1 text-sm font-medium hover:bg-white/25"
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadRow({
  thread,
  folder,
  active,
  index = 0,
  onClick,
}: {
  thread: ThreadSummaryDTO;
  folder: InboxFolder;
  active: boolean;
  index?: number;
  onClick: () => void;
}) {
  const peerLabel =
    thread.peerKind === "to" || folder === "sent" || folder === "awaiting"
      ? thread.peer
        ? `To: ${thread.peer}`
        : "To: (no recipient)"
      : thread.peerName || thread.peer || "Unknown";

  const deliveryBad =
    thread.deliveryStatus === "bounced" ||
    thread.deliveryStatus === "failed" ||
    thread.deliveryStatus === "complained";
  const deliveryPending =
    thread.deliveryStatus === "sending" || thread.deliveryStatus === "queued";

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index, 8) * 0.02 }}
      className={cn(
        "relative flex w-full flex-col gap-0.5 border-b border-border-2 px-4 py-3 text-left transition-colors hover:bg-muted",
        active && "bg-accent-soft hover:bg-accent-soft",
        thread.hasUnread && "bg-accent-soft/40",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-0.5",
          thread.priority === "urgent" && "bg-rose-500",
          thread.priority === "high" && "bg-amber-500",
          thread.priority === "low" && "bg-border",
          (!thread.priority || thread.priority === "normal") && "bg-transparent",
        )}
        aria-hidden
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {thread.hasUnread ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" title="Unread" />
          ) : (
            <span className="h-2 w-2 shrink-0" />
          )}
          <span
            className={cn(
              "truncate text-sm text-ink-2",
              thread.hasUnread && "font-semibold text-ink",
            )}
          >
            {peerLabel}
          </span>
        </div>
        <span className="shrink-0 text-xs text-ink-3">{relativeTime(thread.timestamp)}</span>
      </div>
      <div className="flex items-center gap-1.5 pl-4">
        <span
          className={cn(
            "truncate text-sm text-ink-2",
            thread.hasUnread && "font-medium text-ink",
          )}
        >
          {thread.subject}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-4">
        {thread.hasAttachments && <Paperclip className="h-3 w-3 shrink-0 text-ink-3" />}
        {deliveryBad && (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-rose-600">
            {thread.deliveryStatus === "bounced" ? "Bounced" : "Not delivered"}
          </span>
        )}
        {deliveryPending && (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-amber-700">
            Sending
          </span>
        )}
        {(thread.draftStatus === "queued" || thread.draftStatus === "running") && (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-accent-d">
            Drafting
          </span>
        )}
        <span className="truncate text-xs text-ink-3">
          {thread.aiActivity || thread.snippet}
        </span>
      </div>
    </motion.button>
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
