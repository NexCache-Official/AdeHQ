"use client";

import { useMemo, useState } from "react";
import type { SavedArtifact } from "@/lib/types";
import {
  emailCopyText,
  type EmailDraftJson,
} from "@/lib/artifacts/intelligence";
import { MessageMarkdown } from "@/components/MessageMarkdown";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { Check, Copy, Download, FileText, Mail, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

function isEmailDraft(artifact: SavedArtifact): boolean {
  return artifact.artifactType === "email_draft";
}

function emailJsonFromArtifact(artifact: SavedArtifact): EmailDraftJson | null {
  if (!isEmailDraft(artifact)) return null;
  const json = artifact.contentJson as Partial<EmailDraftJson>;
  if (json.subject && json.body) return json as EmailDraftJson;
  const subject = artifact.contentMarkdown.match(/\*\*Subject:\*\*\s*(.+)/)?.[1]?.trim();
  const bodyStart = artifact.contentMarkdown.indexOf("\n\n");
  const body = bodyStart >= 0 ? artifact.contentMarkdown.slice(bodyStart).trim() : artifact.contentMarkdown;
  return {
    subject: subject ?? artifact.title,
    to: null,
    recipientName: json.recipientName ?? null,
    recipientOrganization: json.recipientOrganization ?? null,
    body,
    signature: json.signature ?? null,
    placeholders: json.placeholders ?? [],
    tone: json.tone ?? "professional",
    purpose: json.purpose ?? "outreach",
    complianceNotes: json.complianceNotes ?? [],
    nextSteps: json.nextSteps ?? [],
  };
}

export function ArtifactViewerModal({
  artifact,
  createdByName,
  onClose,
  onSave,
  onSaveToMemory,
  onCreateTask,
  onExportToDrive,
  busy,
  memorySaved,
  exportBusy,
}: {
  artifact: SavedArtifact;
  createdByName?: string;
  onClose: () => void;
  onSave?: () => void;
  onSaveToMemory?: () => void;
  onCreateTask?: () => void;
  onExportToDrive?: () => void;
  busy?: boolean;
  memorySaved?: boolean;
  exportBusy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const email = useMemo(() => emailJsonFromArtifact(artifact), [artifact]);
  const isEmail = Boolean(email);

  const copyContent = async () => {
    const text = email ? emailCopyText(email) : artifact.contentMarkdown;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const downloadMarkdown = () => {
    const blob = new Blob([artifact.contentMarkdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.title.replace(/[^\w\s-]/g, "").slice(0, 48) || "artifact"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    window.print();
  };

  const typeLabel = artifact.artifactType.replace(/_/g, " ");

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader
        title={artifact.title}
        subtitle={`${typeLabel} · ${artifact.status}`}
        icon={isEmail ? <Mail className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        onClose={onClose}
      />
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          {createdByName && <span>Created by {createdByName}</span>}
          {artifact.sourceMessageIds.length > 0 && (
            <span>· Linked to source message</span>
          )}
        </div>

        {isEmail && email ? (
          <div className="space-y-4">
            <p className="rounded-lg border border-border bg-canvas px-3 py-2 text-[11px] text-ink-2">
              Draft only — open Approvals or Inbox drafts to review and send from the workspace mailbox.
            </p>
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Subject</span>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-ink">
                {email.subject}
              </div>
            </label>
            {(email.recipientName || email.recipientOrganization) && (
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">To</span>
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-ink">
                  {[email.recipientName, email.recipientOrganization].filter(Boolean).join(" · ")}
                </div>
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Body</span>
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-3 text-[13px] leading-relaxed text-ink">
                {email.body}
                {email.signature ? `\n\n${email.signature}` : ""}
              </div>
            </label>
            {email.complianceNotes.length > 0 && (
              <div className="rounded-lg border border-border-2 bg-muted/30 px-3 py-2 text-[11px] text-ink-3">
                {email.complianceNotes.join(" ")}
              </div>
            )}
          </div>
        ) : (
          <MessageMarkdown content={artifact.contentMarkdown || "No artifact content."} />
        )}

        {artifact.sourceCitations.length > 0 && (
          <div className="mt-5 rounded-xl border border-border bg-muted p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Sources</div>
            <div className="space-y-1 text-xs text-ink-3">
              {artifact.sourceCitations.slice(0, 4).map((source, index) => (
                <p key={index}>
                  {typeof source.fileName === "string" ? source.fileName : "Source"}
                  {typeof source.snippet === "string" ? ` — ${source.snippet}` : ""}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
        <Button variant="secondary" size="sm" onClick={() => void copyContent()}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {isEmail ? "Copy email" : "Copy"}
        </Button>
        {onSave && artifact.status === "draft" && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={onSave}>
            Save
          </Button>
        )}
        {onSaveToMemory && (
          <Button variant="secondary" size="sm" disabled={busy || memorySaved} onClick={onSaveToMemory}>
            {memorySaved ? "Saved to memory" : "Save to memory"}
          </Button>
        )}
        {onCreateTask && (
          <Button variant="ghost" size="sm" onClick={onCreateTask}>
            Create follow-up task
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={downloadMarkdown}>
          <Download className="h-3.5 w-3.5" />
          Download .md
        </Button>
        {onExportToDrive && (
          <Button variant="secondary" size="sm" disabled={exportBusy} onClick={onExportToDrive}>
            {exportBusy ? "Exporting…" : "Save to Drive exports"}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={exportPdf}>
          <Printer className="h-3.5 w-3.5" />
          Export PDF
        </Button>
      </div>
    </Modal>
  );
}

export function EmailArtifactInlineCard({
  title,
  subject,
  body,
  recipient,
  company,
  createdBy,
  status = "draft",
  inboxHref,
  onOpen,
  onCopy,
  className,
}: {
  title: string;
  subject?: string;
  body?: string;
  recipient?: string;
  company?: string;
  createdBy?: string;
  status?: "draft" | "saved";
  /** Deep link into workspace Inbox for this draft/thread. */
  inboxHref?: string | null;
  onOpen?: () => void;
  onCopy?: () => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (onCopy) {
      onCopy();
    } else if (body) {
      await navigator.clipboard.writeText(subject ? `Subject: ${subject}\n\n${body}` : body);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className={cn(
        "mt-2 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-d">
              <Mail className="h-3 w-3" /> Email draft
            </span>
            <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
              {status === "saved" ? "Saved" : "Not sent"}
            </span>
          </div>
          <p className="mt-1.5 truncate text-sm font-semibold text-ink">{subject || title}</p>
          {(recipient || company) && (
            <p className="mt-0.5 truncate text-[12px] text-ink-2">
              To {[recipient, company].filter(Boolean).join(" · ")}
            </p>
          )}
          {createdBy && <p className="mt-0.5 text-[10px] text-ink-3">Created by {createdBy}</p>}
        </div>
      </div>
      {body && (
        <div className="max-h-48 overflow-y-auto px-3.5 py-3">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink">{body}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3.5 py-2">
        <p className="text-[10px] text-ink-3">Review in Approvals or Inbox drafts to send.</p>
        <div className="flex flex-wrap gap-1.5">
          {inboxHref && (
            <a
              href={inboxHref}
              className="rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
            >
              Inbox
            </a>
          )}
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className="rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
            >
              Open
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
