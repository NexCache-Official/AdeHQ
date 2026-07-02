"use client";

import { useState } from "react";
import { RoomMessage } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { cn, formatTime } from "@/lib/utils";
import { normalizeHumanDelivery } from "@/lib/message-delivery";
import { saveSuggestedMemoryClient } from "@/lib/topic-summary/client";
import { ArtifactCard, FileArtifactCard } from "./ArtifactCard";
import { MessageMarkdown } from "./MessageMarkdown";
import {
  BrainCircuit,
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

function MemorySuggestionArtifact({
  artifact,
  topicId,
}: {
  artifact: import("@/lib/types").MessageArtifact;
  topicId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || saved || !topicId) return null;

  const text = artifact.meta?.memoryText ?? artifact.label;
  const suggestionIndex = artifact.meta?.suggestionIndex;

  const save = async () => {
    if (typeof suggestionIndex !== "number") return;
    setBusy(true);
    try {
      await saveSuggestedMemoryClient(topicId, suggestionIndex);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 w-full max-w-lg rounded-xl border border-cyan-200/80 bg-cyan-50/40 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-cyan-900">Save to memory?</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink">{text}</p>
          {artifact.meta?.reason && (
            <p className="mt-1 text-[10px] text-ink-3">{artifact.meta.reason}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-[11px]"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save
            </Button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-ink-3 hover:bg-muted hover:text-ink"
            >
              <X className="h-3 w-3" />
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

function MessageActions({
  message,
  isHuman,
  hasSources,
}: {
  message: RoomMessage;
  isHuman: boolean;
  hasSources: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const disabledTitle = "Coming in Phase 3";

  return (
    <div className="absolute right-0 top-0 z-10 hidden -translate-y-1/2 items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 shadow-md group-hover/msg:flex group-focus-within/msg:flex">
      <button
        type="button"
        onClick={() => void copy()}
        className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-muted hover:text-ink"
        aria-label="Copy message"
        title="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        disabled
        title={isHuman ? disabledTitle : "Create artifact from this message in Phase 3"}
        className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-ink-3 opacity-45"
        aria-label={isHuman ? "Create task from message" : "Create artifact from this"}
      >
        {isHuman ? <ListChecks className="h-3.5 w-3.5" /> : <FilePlus2 className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        disabled
        title="Save to memory in Phase 3"
        className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-ink-3 opacity-45"
        aria-label="Save to memory"
      >
        <BrainCircuit className="h-3.5 w-3.5" />
      </button>
      {isHuman ? (
        <button
          type="button"
          disabled
          title="Quote or reply in Phase 3"
          className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-ink-3 opacity-45"
          aria-label="Quote reply"
        >
          <Quote className="h-3.5 w-3.5" />
        </button>
      ) : (
        <button
          type="button"
          disabled
          title={hasSources ? "Source preview arrives with file Q&A" : disabledTitle}
          className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-ink-3 opacity-45"
          aria-label="View sources"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        disabled
        title={disabledTitle}
        className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full text-ink-3 opacity-45"
        aria-label="More message actions"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function RoomMessageItem({
  message,
  isDm = false,
  grouped = false,
}: {
  message: RoomMessage;
  isDm?: boolean;
  grouped?: boolean;
}) {
  const { state } = useStore();
  const employee = state.employees.find((e) => e.id === message.senderId);

  if (message.senderType === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-ink-3">
          {message.content}
        </span>
      </div>
    );
  }

  const isHuman = message.senderType === "human";
  const emailDrafts = message.artifacts?.filter((a) => a.type === "email_draft") ?? [];
  const memorySuggestions =
    message.artifacts?.filter((a) => a.type === "memory_suggestion") ?? [];
  const generatedArtifacts = message.artifacts?.filter((a) => a.type === "artifact") ?? [];
  const fileArtifacts = message.artifacts?.filter((a) => a.type === "file") ?? [];
  const otherArtifacts = (message.artifacts ?? []).filter(
    (
      a,
    ): a is import("@/lib/types").MessageArtifact & {
      type: "task" | "memory" | "approval" | "work_log";
    } =>
      a.type !== "email_draft" &&
      a.type !== "memory_suggestion" &&
      a.type !== "artifact" &&
      a.type !== "file" &&
      !(isDm && a.type === "work_log") &&
      (a.type === "task" ||
        a.type === "memory" ||
        a.type === "approval" ||
        a.type === "work_log"),
  );
  const hasSources = message.content.includes("[[source:");

  return (
    <div
      className={cn(
        "group/msg relative flex gap-3 rounded-[10px] px-0 hover:bg-black/[0.015]",
        grouped ? "py-0.5" : "py-2",
      )}
    >
      <MessageActions message={message} isHuman={isHuman} hasSources={hasSources} />
      <div className="w-9 shrink-0">
        {grouped ? null : isHuman ? (
          <HumanAvatar name={message.senderName} size="md" />
        ) : employee ? (
          <EmployeeAvatar employee={employee} size="md" showStatus={false} />
        ) : (
          <HumanAvatar name={message.senderName} size="md" accent="#475569" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-semibold text-ink">{message.senderName}</span>
            {!isHuman && (
              <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold text-accent">
                AI
              </span>
            )}
            {!isHuman && employee && (
              <span className="text-[11px] text-ink-3">{employee.role}</span>
            )}
            {!isHuman && (
              <span className="font-mono text-[10.5px] text-ink-3">{formatTime(message.createdAt)}</span>
            )}
          </div>
        )}

        {isHuman ? (
          <>
            <div
              className={cn(
                message.pending ? "text-ink-2" : "text-ink",
              )}
            >
              <MessageMarkdown content={message.content} compact />
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
          <MessageMarkdown content={message.content} />
        )}

        {emailDrafts.map((draft) => (
          <EmailDraftCard key={draft.id} label={draft.label} meta={draft.meta} />
        ))}

        {memorySuggestions.map((artifact) => (
          <MemorySuggestionArtifact
            key={artifact.id}
            artifact={artifact}
            topicId={message.topicId}
          />
        ))}

        {generatedArtifacts.map((artifact) => (
          <ArtifactCard
            key={artifact.id}
            title={artifact.label}
            type={artifact.meta?.artifactType ?? "note"}
            createdBy={artifact.meta?.createdByName ?? message.senderName}
            timestamp={message.createdAt}
            sourceCount={artifact.meta?.sourceCount ?? 0}
            status={artifact.meta?.artifactStatus ?? "draft"}
          />
        ))}

        {fileArtifacts.map((artifact) => (
          <FileArtifactCard
            key={artifact.id}
            fileName={artifact.meta?.fileName ?? artifact.label}
            extension={artifact.meta?.fileExtension}
            size={artifact.meta?.fileSizeLabel}
            status={artifact.meta?.fileStatus ?? "attached"}
            className="mt-2 max-w-lg"
          />
        ))}

        {otherArtifacts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {otherArtifacts.map((a) => {
              const meta = ARTIFACT_META[a.type];
              const Icon = meta.icon;
              return (
                <span
                  key={a.id + a.label}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium",
                    meta.color,
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {a.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
