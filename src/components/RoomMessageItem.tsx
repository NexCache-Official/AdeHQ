"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { AIEmployee, MessageArtifact, RoomMessage } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { cn, formatTime } from "@/lib/utils";
import { normalizeHumanDelivery } from "@/lib/message-delivery";
import {
  collectMessageSources,
  firstArtifactFromMessage,
  messageHasSources,
  type MessageActionHandlers,
  type MessageSourceRef,
} from "@/lib/message-actions";
import { ArtifactCard, FileArtifactCard } from "./ArtifactCard";
import { ChatFileMiniViewer } from "@/components/chat/ChatFileMiniViewer";
import { EmailArtifactInlineCard } from "@/components/artifacts/ArtifactViewerModal";
import { CrmInlineCard } from "@/components/crm/CrmInlineCard";
import { ToolResultInlineCard } from "@/components/integrations/ToolResultInlineCard";
import { AutonomousLauncher } from "@/components/autonomy/AutonomousLauncher";
import { AutonomousSessionChip } from "@/components/autonomy/AutonomousSessionChip";
import { CompactSourcesRow } from "@/components/search/CompactSourcesRow";
import { resolveWebSources } from "@/lib/message-artifacts/resolve-source-artifacts";
import {
  chatFilePreviewKind,
  isPreviewableChatFile,
} from "@/lib/chat/file-preview-kind";
import { MessageMarkdown } from "./MessageMarkdown";
import { EmailBridgeMessageCard } from "@/components/chat/EmailBridgeMessageCard";
import {
  isEmailBridgeClientMessageId,
  isEmailBridgeMessageContent,
} from "@/lib/inbox/email-bridge-display";
import { ApprovalCard } from "./ApprovalCard";
import {
  BrainCircuit,
  Bot,
  Check,
  Copy,
  FilePlus2,
  ListChecks,
  Loader2,
  Mail,
  MoreHorizontal,
  Quote,
  ScrollText,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "./ui";
import { useDebugTrace } from "./DebugProvider";

const ARTIFACT_META = {
  task: { icon: ListChecks, color: "text-sky-700 bg-sky-50", href: "/tasks" },
  memory: { icon: BrainCircuit, color: "text-cyan-700 bg-cyan-50", href: "/memory" },
  approval: { icon: ShieldAlert, color: "text-amber-700 bg-amber-50", href: "/approvals" },
  work_log: { icon: ScrollText, color: "text-violet-700 bg-violet-50", href: "/work-log" },
  email_draft: { icon: Mail, color: "text-emerald-700 bg-emerald-50", href: undefined },
};

function EmailDraftCard({
  label,
  meta,
}: {
  label: string;
  meta?: { subject?: string; body?: string; recipient?: string; company?: string };
}) {
  const [copied, setCopied] = useState(false);
  if (!meta?.body) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
        <Mail className="h-3 w-3" />
        {label}
      </span>
    );
  }

  const fullText = meta.subject ? `Subject: ${meta.subject}\n\n${meta.body}` : meta.body;

  const copy = async () => {
    await navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-2 w-full max-w-lg overflow-hidden rounded-xl border border-emerald-200/80 bg-emerald-50/40">
      <div className="flex items-center justify-between gap-2 border-b border-emerald-200/60 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <Mail className="h-3.5 w-3.5" />
          {label}
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => void copy()}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {meta.subject && (
        <div className="border-b border-emerald-200/40 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-600">Subject</p>
          <p className="text-sm font-medium text-ink">{meta.subject}</p>
        </div>
      )}
      <div className="px-3 py-2.5">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{meta.body}</p>
      </div>
    </div>
  );
}

function AutopilotOfferCard({
  artifact,
  employee,
  onStart,
}: {
  artifact: MessageArtifact;
  employee?: AIEmployee;
  onStart: () => void;
}) {
  const objective = artifact.meta?.objective ?? artifact.label;
  return (
    <div className="mt-2 flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent-soft/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-d">
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span>Autopilot offer</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-2">
          {employee ? `${employee.name}: ` : ""}
          {objective}
        </p>
      </div>
      <Button size="sm" variant="secondary" className="h-8 shrink-0" onClick={onStart}>
        <Sparkles className="h-3.5 w-3.5" />
        Run
      </Button>
    </div>
  );
}

// NOTE: "Save to memory?" suggestions render in the topic/DM summary panel
// (right rail — see TopicSummaryPanel) only. They used to also render as an
// inline chat card here, but that surfaced a full-topic re-analysis result
// that can reference older conversation context onto whichever message
// happened to be newest — reading as a stale/unrelated suggestion attached
// to the wrong message. Keep suggestion review/save/dismiss in one place.

function ReadReceiptAvatars({
  seenBy,
  isDm,
}: {
  seenBy: NonNullable<RoomMessage["seenBy"]>;
  isDm?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!seenBy.length) return null;

  const names = seenBy.map((s) => s.name).join(", ");

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="inline-flex -space-x-1">
        {seenBy.slice(0, 3).map((reader) => (
          <span
            key={reader.id}
            className="flex h-4 w-4 items-center justify-center rounded-full border border-surface bg-muted text-[8px] font-semibold text-ink-3"
            title={reader.name}
          >
            {reader.name
              .split(/\s+/)
              .map((p) => p[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
        ))}
      </span>
      {seenBy.length > 3 && (
        <span className="ml-1 text-[10px] text-ink-3">+{seenBy.length - 3}</span>
      )}
      {open && (
        <span className="absolute bottom-full right-0 z-20 mb-1 w-max max-w-[220px] rounded-lg border border-border bg-surface px-2 py-1.5 text-[10px] text-ink-2 shadow-md">
          {isDm ? `Seen by ${names}` : `Seen by: ${names}`}
        </span>
      )}
    </span>
  );
}

function DeliveryStatus({
  message,
  isDm,
}: {
  message: RoomMessage;
  isDm?: boolean;
}) {
  const normalized = normalizeHumanDelivery(message);
  const isSending = normalized.pending || normalized.deliveryStatus === "sending";
  const isFailed = normalized.failed || normalized.deliveryStatus === "failed";
  const deliveredAt = normalized.deliveredAt ?? normalized.createdAt;

  if (isFailed) {
    return <span className="text-[10px] font-medium text-rose-600">Failed to send</span>;
  }

  if (isSending) {
    return <span className="text-[10px] text-ink-3">Sending…</span>;
  }

  const seenByAi = normalized.seenBy?.some((reader) => reader.type === "ai");

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-3">
      <span>
        {isDm && seenByAi ? "Seen" : "Delivered"} · {formatTime(deliveredAt)}
      </span>
      {message.seenBy && message.seenBy.length > 0 && (
        <ReadReceiptAvatars seenBy={normalized.seenBy ?? message.seenBy} isDm={isDm} />
      )}
    </span>
  );
}

function SourcesPopover({
  sources,
  onClose,
}: {
  sources: MessageSourceRef[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-30 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-2 shadow-panel"
    >
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
        Sources ({sources.length})
      </p>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {sources.map((source) => (
          <div
            key={source.id}
            className="rounded-lg border border-border-2 bg-muted/60 px-2 py-1.5"
          >
            <p className="text-[11px] font-semibold text-ink">{source.label}</p>
            {source.quote && (
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-ink-3">
                {source.quote}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageActions({
  message,
  isHuman,
  handlers,
  disabled,
}: {
  message: RoomMessage;
  isHuman: boolean;
  handlers?: MessageActionHandlers;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const sources = collectMessageSources(message);
  const hasSources = messageHasSources(message);
  const linkedArtifact = firstArtifactFromMessage(message);
  const actionsDisabled = disabled || busy || !handlers;

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const run = async (action?: () => void | Promise<void>) => {
    if (!action || actionsDisabled) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      setMoreOpen(false);
      setSourcesOpen(false);
    }
  };

  const actionButtonClass =
    "flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <div className="absolute right-0 top-0 z-10 hidden -translate-y-1/2 items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 shadow-md group-hover/msg:flex group-focus-within/msg:flex">
      <button
        type="button"
        onClick={() => void copy()}
        className={actionButtonClass}
        aria-label="Copy message"
        title="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        disabled={
          actionsDisabled ||
          (isHuman ? !handlers?.onCreateTaskFromMessage : !handlers?.onCreateArtifactFromMessage)
        }
        onClick={() =>
          void run(() =>
            isHuman
              ? handlers?.onCreateTaskFromMessage?.(message)
              : handlers?.onCreateArtifactFromMessage?.(message),
          )
        }
        className={actionButtonClass}
        aria-label={isHuman ? "Create task from message" : "Save as artifact"}
        title={isHuman ? "Create task" : linkedArtifact ? "Open artifact" : "Save as artifact"}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isHuman ? (
          <ListChecks className="h-3.5 w-3.5" />
        ) : (
          <FilePlus2 className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        disabled={actionsDisabled || !handlers?.onSaveMessageToMemory}
        onClick={() => void run(() => handlers?.onSaveMessageToMemory?.(message))}
        className={actionButtonClass}
        aria-label="Save to memory"
        title="Save to memory"
      >
        <BrainCircuit className="h-3.5 w-3.5" />
      </button>
      {isHuman ? (
        <button
          type="button"
          disabled={actionsDisabled || !handlers?.onQuoteReply}
          onClick={() => handlers?.onQuoteReply?.(message)}
          className={actionButtonClass}
          aria-label="Quote reply"
          title="Quote in reply"
        >
          <Quote className="h-3.5 w-3.5" />
        </button>
      ) : (
        <div className="relative">
          <button
            type="button"
            disabled={!hasSources}
            onClick={() => setSourcesOpen((open) => !open)}
            className={actionButtonClass}
            aria-label="View sources"
            title={hasSources ? "View sources" : "No sources in this message"}
            aria-expanded={sourcesOpen}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
          {sourcesOpen && hasSources && (
            <SourcesPopover sources={sources} onClose={() => setSourcesOpen(false)} />
          )}
        </div>
      )}
      <div className="relative" ref={moreRef}>
        <button
          type="button"
          disabled={actionsDisabled}
          onClick={() => setMoreOpen((open) => !open)}
          className={actionButtonClass}
          aria-label="More message actions"
          title="More actions"
          aria-expanded={moreOpen}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {moreOpen && handlers && (
          <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-xl border border-border bg-surface p-1 shadow-panel">
            {!isHuman && handlers.onAskFollowUp && (
              <button
                type="button"
                className="flex w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-muted"
                onClick={() => {
                  handlers.onAskFollowUp?.(message);
                  setMoreOpen(false);
                }}
              >
                Ask follow-up
              </button>
            )}
            {linkedArtifact && handlers.onOpenArtifactFromMessage && (
              <button
                type="button"
                className="flex w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-muted"
                onClick={() => {
                  handlers.onOpenArtifactFromMessage?.(message);
                  setMoreOpen(false);
                }}
              >
                Open artifact
              </button>
            )}
            {isHuman && handlers.onCreateArtifactFromMessage && (
              <button
                type="button"
                className="flex w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-muted"
                onClick={() => void run(() => handlers.onCreateArtifactFromMessage?.(message))}
              >
                Save as note
              </button>
            )}
            {!isHuman && handlers.onCreateTaskFromMessage && (
              <button
                type="button"
                className="flex w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-muted"
                onClick={() => void run(() => handlers.onCreateTaskFromMessage?.(message))}
              >
                Create task
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalArtifactSlot({
  artifactId,
  label,
}: {
  artifactId: string;
  label: string;
}) {
  const { state, actions } = useStore();
  const approval = state.approvals.find((x) => x.id === artifactId);

  useEffect(() => {
    if (approval) return;
    void actions.ensureApproval(artifactId);
    const t = window.setTimeout(() => void actions.ensureApproval(artifactId), 600);
    return () => window.clearTimeout(t);
  }, [actions, approval, artifactId]);

  // Keep pending email cards synced with inbox send/discard.
  useEffect(() => {
    if (!approval || approval.status !== "pending") return;
    const tool =
      typeof approval.actionPayload?.tool === "string" ? approval.actionPayload.tool : "";
    if (tool !== "email.sendDraft") return;
    const poll = window.setInterval(() => {
      void actions.ensureApproval(artifactId);
    }, 6000);
    return () => window.clearInterval(poll);
  }, [actions, approval, artifactId]);

  if (approval) {
    return (
      <div className="mt-2.5 max-w-xl">
        <ApprovalCard approval={approval} />
      </div>
    );
  }

  return (
    <Link
      href={`/approvals?id=${encodeURIComponent(artifactId)}`}
      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
    >
      <ShieldAlert className="h-3 w-3" />
      {label}
      <span className="text-amber-700/80">· Review</span>
    </Link>
  );
}

export function RoomMessageItem({
  message,
  isDm = false,
  grouped = false,
  messageActions,
  actionsDisabled,
}: {
  message: RoomMessage;
  isDm?: boolean;
  grouped?: boolean;
  messageActions?: MessageActionHandlers;
  actionsDisabled?: boolean;
}) {
  const { state } = useStore();
  const { enabled: debugEnabled } = useDebugTrace();
  const [autopilotOffer, setAutopilotOffer] = useState<{
    objective: string;
    employeeId?: string;
  } | null>(null);
  const topic = state.topics.find((t) => t.id === message.topicId);
  const messageRoomId = topic?.roomId;
  const room = messageRoomId ? state.rooms.find((r) => r.id === messageRoomId) : undefined;
  const roomEmployees = room
    ? state.employees.filter((e) => room.aiEmployees.includes(e.id))
    : state.employees;
  const employee = state.employees.find((e) => e.id === message.senderId);

  const mentionParticipants = useMemo(
    () => [
      ...state.employees.map((e) => ({
        id: e.id,
        name: e.name,
        type: "ai_employee" as const,
      })),
      ...state.workspaceMembers.map((m) => ({
        id: m.userId,
        name: m.name ?? m.email ?? "Teammate",
        type: "human" as const,
      })),
    ],
    [state.employees, state.workspaceMembers],
  );

  const isEmailBridge =
    isEmailBridgeClientMessageId(message.clientMessageId) ||
    isEmailBridgeMessageContent(message.content);

  if (message.senderType === "system") {
    if (isEmailBridge) {
      return (
        <div className="flex justify-center py-2 px-1">
          <EmailBridgeMessageCard content={message.content} compact />
        </div>
      );
    }
    return (
      <div className="flex justify-center py-2">
        <span className="max-w-md rounded-full bg-muted px-3 py-1 text-center text-[11px] text-ink-3">
          {message.content.length > 180
            ? `${message.content.slice(0, 177).trim()}…`
            : message.content}
        </span>
      </div>
    );
  }

  const isHuman = message.senderType === "human";
  const emailDrafts = message.artifacts?.filter((a) => a.type === "email_draft") ?? [];
  const generatedArtifacts = message.artifacts?.filter((a) => a.type === "artifact") ?? [];
  const citationArtifacts =
    message.senderType === "ai"
      ? (message.artifacts?.filter((a) => a.type === "file" && a.meta?.chunkId) ?? [])
      : [];
  const fileArtifacts = message.artifacts?.filter(
    (a) => a.type === "file" && !a.meta?.chunkId,
  ) ?? [];
  const workLogArtifacts = message.artifacts?.filter((a) => a.type === "work_log") ?? [];
  const webSourceArtifacts =
    message.artifacts?.filter(
      (a) => a.type === "web_sources" || a.type === "search_sources",
    ) ?? [];
  const knowledgeSourceArtifacts =
    message.artifacts?.filter((a) => a.type === "knowledge_sources") ?? [];
  const inlineCitationSources =
    webSourceArtifacts.length > 0 ? resolveWebSources(webSourceArtifacts[0]) : undefined;
  const crmArtifacts =
    message.artifacts?.filter(
      (a) => a.type === "crm_contact" || a.type === "crm_deal" || a.type === "crm_company",
    ) ?? [];
  const toolResultArtifacts = message.artifacts?.filter((a) => a.type === "tool_result") ?? [];
  const workModeArtifacts = message.artifacts?.filter((a) => a.type === "work_mode") ?? [];
  const sessionArtifacts = message.artifacts?.filter((a) => a.type === "autonomous_session") ?? [];
  const autopilotOfferArtifacts =
    message.artifacts?.filter((a) => a.type === "autopilot_offer") ?? [];
  const otherArtifacts = (message.artifacts ?? []).filter(
    (
      a,
    ): a is import("@/lib/types").MessageArtifact & {
      type: "task" | "memory" | "approval";
    } =>
      a.type !== "email_draft" &&
      a.type !== "memory_suggestion" &&
      a.type !== "artifact" &&
      a.type !== "file" &&
      a.type !== "work_log" &&
      a.type !== "search_sources" &&
      a.type !== "web_sources" &&
      a.type !== "knowledge_sources" &&
      a.type !== "crm_contact" &&
      a.type !== "crm_deal" &&
      a.type !== "crm_company" &&
      a.type !== "tool_result" &&
      a.type !== "autonomous_session" &&
      a.type !== "autopilot_offer" &&
      (a.type === "task" || a.type === "memory" || a.type === "approval"),
  );
  const debugWorkLogArtifacts = debugEnabled ? workLogArtifacts : [];

  return (
    <div
      id={`msg-${message.id}`}
      data-message-id={message.id}
      className={cn(
        "chat-message-enter group/msg relative flex gap-2.5 rounded-[10px] px-0 transition-colors hover:bg-black/[0.015]",
        grouped ? "py-0.5" : "py-1.5",
      )}
    >
      <MessageActions
        message={message}
        isHuman={isHuman}
        handlers={messageActions}
        disabled={actionsDisabled}
      />
      <div className="w-8 shrink-0">
        {grouped ? null : isHuman ? (
          <HumanAvatar name={message.senderName} size="sm" />
        ) : employee ? (
          <EmployeeAvatar employee={employee} size="sm" showStatus={false} />
        ) : (
          <HumanAvatar name={message.senderName} size="sm" accent="#475569" />
        )}
      </div>

      <div className="relative min-w-0 flex-1">
        {!grouped && (
          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-semibold text-ink">{message.senderName}</span>
            {!isHuman && (
              <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent">
                AI
              </span>
            )}
            {!isHuman && employee && (
              <span className="text-[11px] text-ink-3">{employee.role}</span>
            )}
            {!isHuman && (
              <span className="font-mono text-[11px] text-ink-3">{formatTime(message.createdAt)}</span>
            )}
          </div>
        )}

        {!grouped && !isHuman && workLogArtifacts.length > 0 && !debugEnabled && (
          <span
            className="pointer-events-none absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-md text-violet-600 opacity-0 transition-opacity group-hover/msg:opacity-70"
            title="Activity logged — see Activity tab"
          >
            <ScrollText className="h-3 w-3" />
          </span>
        )}

        {isHuman ? (
          <>
            {workModeArtifacts.map((artifact) => {
              const mode = artifact.meta?.workMode;
              const label =
                mode === "fast"
                  ? "⚡ Fast"
                  : mode === "balanced"
                    ? "⚖️ Balanced"
                    : mode === "deep"
                      ? "🧠 Deep Thinking"
                      : mode === "research"
                        ? "🌍 Research"
                        : mode === "collaboration"
                          ? "🤝 Collaboration"
                          : artifact.label;
              return (
                <span
                  key={artifact.id}
                  className="mb-1 inline-flex rounded-full border border-accent/20 bg-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-accent-d"
                >
                  {label}
                </span>
              );
            })}
            <div
              className={cn(
                message.pending ? "text-ink-2" : "text-ink",
              )}
            >
              {isEmailBridge ? (
                <EmailBridgeMessageCard content={message.content} compact />
              ) : (
                <MessageMarkdown
                  content={message.content}
                  compact
                  roomScale
                  mentionsJson={message.mentionsJson}
                  mentionParticipants={mentionParticipants}
                />
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
              <DeliveryStatus message={message} isDm={isDm} />
            </div>
          </>
        ) : message.pending ? (
          <div className="flex w-fit items-center gap-1.5 rounded-[13px] border border-border bg-surface px-3.5 py-2.5">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        ) : (
          <div className={cn(message.streaming && "streaming-caret")}>
            <MessageMarkdown
              content={message.content}
              roomScale
              mentionsJson={message.mentionsJson}
              mentionParticipants={mentionParticipants}
              citationSources={inlineCitationSources}
            />
          </div>
        )}

        {emailDrafts.map((draft) => (
          <EmailDraftCard key={draft.id} label={draft.label} meta={draft.meta} />
        ))}

        {crmArtifacts.map((artifact) => (
          <CrmInlineCard key={`${artifact.type}-${artifact.id}`} artifact={artifact} />
        ))}

        {toolResultArtifacts.map((artifact) => (
          <ToolResultInlineCard
            key={`tool-${artifact.id}`}
            artifact={artifact}
            context={{
              workspaceId: state.workspace.id,
              employeeId: message.senderType === "ai" ? message.senderId : undefined,
              roomId: messageRoomId,
              topicId: message.topicId,
              messageId: message.id,
            }}
          />
        ))}

        {sessionArtifacts.map((artifact) => (
          <AutonomousSessionChip key={`session-${artifact.id}`} sessionId={artifact.id} label={artifact.label} />
        ))}

        {autopilotOfferArtifacts.map((artifact) => {
          const offerEmployeeId = artifact.meta?.autopilotEmployeeId ?? message.senderId;
          const offerEmployee = state.employees.find((e) => e.id === offerEmployeeId);
          return (
            <AutopilotOfferCard
              key={`autopilot-offer-${artifact.id}`}
              artifact={artifact}
              employee={offerEmployee}
              onStart={() =>
                setAutopilotOffer({
                  objective: artifact.meta?.objective ?? artifact.label,
                  employeeId: offerEmployeeId,
                })
              }
            />
          );
        })}

        {webSourceArtifacts.map((artifact) => (
          <CompactSourcesRow key={artifact.id} kind="web" artifact={artifact} />
        ))}

        {knowledgeSourceArtifacts.map((artifact) => (
          <CompactSourcesRow key={artifact.id} kind="knowledge" artifact={artifact} />
        ))}

        {generatedArtifacts.map((artifact) => {
          if (artifact.meta?.artifactType === "email_draft") {
            return (
              <EmailArtifactInlineCard
                key={artifact.id}
                title={artifact.label}
                subject={artifact.meta?.subject}
                body={artifact.meta?.body}
                recipient={artifact.meta?.recipient}
                company={artifact.meta?.company}
                createdBy={artifact.meta?.createdByName ?? message.senderName}
                status={artifact.meta?.artifactStatus ?? "draft"}
                inboxHref={
                  typeof artifact.meta?.emailThreadId === "string" && artifact.meta.emailThreadId
                    ? `/inbox?thread=${encodeURIComponent(artifact.meta.emailThreadId)}`
                    : typeof artifact.meta?.inboxDraftId === "string" && artifact.meta.inboxDraftId
                      ? "/inbox?folder=drafts"
                      : "/inbox"
                }
                onOpen={() => {
                  window.dispatchEvent(
                    new CustomEvent("adehq:open-artifact", {
                      detail: { artifactId: artifact.id, topicId: message.topicId },
                    }),
                  );
                }}
              />
            );
          }
          return (
            <ArtifactCard
              key={artifact.id}
              title={artifact.label}
              type={(artifact.meta?.artifactType as "prd" | "report" | "brief" | "proposal" | "decision" | "note") ?? "note"}
              createdBy={artifact.meta?.createdByName ?? message.senderName}
              timestamp={message.createdAt}
              sourceCount={artifact.meta?.sourceCount ?? 0}
              status={artifact.meta?.artifactStatus ?? "draft"}
              onOpen={() => {
                window.dispatchEvent(
                  new CustomEvent("adehq:open-artifact", {
                    detail: { artifactId: artifact.id, topicId: message.topicId },
                  }),
                );
                window.dispatchEvent(
                  new CustomEvent("adehq:topic-artifacts-changed", {
                    detail: { topicId: message.topicId },
                  }),
                );
              }}
            />
          );
        })}

        {citationArtifacts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {citationArtifacts.map((artifact) => (
              <span
                key={artifact.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent/20 bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-d"
                title={artifact.meta?.quote}
              >
                <Sparkles className="h-3 w-3 shrink-0" />
                <span className="truncate">{artifact.label}</span>
              </span>
            ))}
          </div>
        )}

        {fileArtifacts.map((artifact) => {
          const fileId = artifact.meta?.fileId ?? artifact.id;
          const extension = artifact.meta?.fileExtension;
          const previewKind = chatFilePreviewKind({
            extension,
            mimeType: artifact.meta?.mimeType,
            fileName: artifact.meta?.fileName ?? artifact.label,
          });
          const canPreview =
            Boolean(state.workspace.id && fileId) &&
            isPreviewableChatFile(previewKind) &&
            (artifact.meta?.fileStatus === "ready" ||
              artifact.meta?.fileStatus === "attached" ||
              !artifact.meta?.fileStatus);

          if (canPreview) {
            return (
              <ChatFileMiniViewer
                key={artifact.id}
                workspaceId={state.workspace.id}
                title={artifact.meta?.fileName ?? artifact.label}
                source={{ type: "file", id: fileId }}
                extension={extension}
                mimeType={artifact.meta?.mimeType}
                driveHref={`/drive?file=${encodeURIComponent(fileId)}`}
                className="max-w-xl"
              />
            );
          }

          return (
            <FileArtifactCard
              key={artifact.id}
              fileName={artifact.meta?.fileName ?? artifact.label}
              extension={extension}
              size={artifact.meta?.fileSizeLabel}
              status={artifact.meta?.fileStatus ?? "attached"}
              className="mt-2 max-w-lg"
            />
          );
        })}

        {/* Pending email/tool approvals: render the real card with Approve/Reject
            in-chat. Eager-fetch missing rows so Review isn't needed after a race. */}
        {otherArtifacts
          .filter((a) => a.type === "approval")
          .map((a) => (
            <ApprovalArtifactSlot key={a.id} artifactId={a.id} label={a.label} />
          ))}

        {(otherArtifacts.some((a) => a.type !== "approval") || debugWorkLogArtifacts.length > 0) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {[...otherArtifacts.filter((a) => a.type !== "approval"), ...debugWorkLogArtifacts].map((a) => {
              if (a.type !== "task" && a.type !== "memory" && a.type !== "work_log") {
                return null;
              }
              const meta = ARTIFACT_META[a.type];
              const Icon = meta.icon;
              const chipClass = cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium",
                meta.color,
              );
              if (meta.href) {
                return (
                  <Link key={a.id + a.label} href={meta.href} className={cn(chipClass, "hover:opacity-90")}>
                    <Icon className="h-3 w-3" />
                    {a.label}
                  </Link>
                );
              }
              return (
                <span key={a.id + a.label} className={chipClass}>
                  <Icon className="h-3 w-3" />
                  {a.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <AutonomousLauncher
        open={autopilotOffer !== null}
        onClose={() => setAutopilotOffer(null)}
        workspaceId={state.workspace.id}
        employees={roomEmployees.length ? roomEmployees : state.employees}
        defaultObjective={autopilotOffer?.objective ?? ""}
        defaultEmployeeId={autopilotOffer?.employeeId}
        roomId={messageRoomId}
        topicId={message.topicId}
      />
    </div>
  );
}
