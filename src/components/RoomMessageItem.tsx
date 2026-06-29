"use client";

import { useState } from "react";
import { RoomMessage } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { cn, formatTime } from "@/lib/utils";
import {
  BrainCircuit,
  Check,
  Copy,
  ListChecks,
  Mail,
  ScrollText,
  ShieldAlert,
} from "lucide-react";
import { motion } from "framer-motion";
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
          <p className="text-sm font-medium text-slate-800">{meta.subject}</p>
        </div>
      )}
      <div className="px-3 py-2.5">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{meta.body}</p>
      </div>
    </div>
  );
}

function renderContent(content: string) {
  const parts = content.split(/(@[A-Za-z][A-Za-z ]*?Employee)/g);
  return parts.map((part, i) =>
    /^@[A-Za-z]/.test(part) && part.includes("Employee") ? (
      <span key={i} className="font-medium text-accent-600">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function RoomMessageItem({ message }: { message: RoomMessage }) {
  const { state } = useStore();
  const employee = state.employees.find((e) => e.id === message.senderId);

  if (message.senderType === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-slate-50 px-3 py-1 text-[11px] text-slate-500">
          {message.content}
        </span>
      </div>
    );
  }

  const isHuman = message.senderType === "human";
  const emailDrafts = message.artifacts?.filter((a) => a.type === "email_draft") ?? [];
  const otherArtifacts = message.artifacts?.filter((a) => a.type !== "email_draft") ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex gap-3 px-1 py-2"
    >
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
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-900">{message.senderName}</span>
          {!isHuman && (
            <span className="rounded-md bg-accent-500/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-700">
              AI
            </span>
          )}
          {!isHuman && employee && (
            <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
              {employee.role}
            </span>
          )}
          <span className="text-[11px] text-slate-500">{formatTime(message.createdAt)}</span>
          {message.failed && (
            <span className="text-[11px] font-medium text-rose-600">Failed to send</span>
          )}
        </div>

        {message.pending ? (
          <div className="mt-1.5 flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-slate-50 px-3.5 py-3 w-fit">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        ) : (
          <div
            className={cn(
              "mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700",
            )}
          >
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
    </motion.div>
  );
}
