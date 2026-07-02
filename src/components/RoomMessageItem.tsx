"use client";

import { useState } from "react";
import { RoomMessage } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { cn, formatTime } from "@/lib/utils";
import { normalizeHumanDelivery } from "@/lib/message-delivery";
import {
  BrainCircuit,
  Check,
  Copy,
  ListChecks,
  Mail,
  ScrollText,
  ShieldAlert,
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

function renderContent(content: string) {
  const parts = content.split(/(@[A-Za-z][A-Za-z ]*?Employee)/g);
  return parts.map((part, i) =>
    /^@[A-Za-z]/.test(part) && part.includes("Employee") ? (
      <span key={i} className="font-medium text-accent">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
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

export function RoomMessageItem({
  message,
  isDm = false,
}: {
  message: RoomMessage;
  isDm?: boolean;
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
  const otherArtifacts = message.artifacts?.filter((a) => a.type !== "email_draft") ?? [];

  return (
    <div className="group/msg relative flex gap-3 rounded-[10px] px-0 py-1">
      <div className="shrink-0">
        {isHuman ? (
          <HumanAvatar name={message.senderName} size="md" />
        ) : employee ? (
          <EmployeeAvatar employee={employee} size="md" showStatus={false} />
        ) : (
          <HumanAvatar name={message.senderName} size="md" accent="#475569" />
        )}
      </div>

      <div className="min-w-0 flex-1">
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

        {isHuman ? (
          <>
            <div
              className={cn(
                "whitespace-pre-wrap text-[14px] leading-[1.55]",
                message.pending ? "text-ink-2" : "text-ink",
              )}
            >
              {renderContent(message.content)}
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
          <div className="whitespace-pre-wrap text-[14px] leading-[1.55] text-ink">
            {renderContent(message.content)}
          </div>
        )}

        {emailDrafts.map((draft) => (
          <EmailDraftCard key={draft.id} label={draft.label} meta={draft.meta} />
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
