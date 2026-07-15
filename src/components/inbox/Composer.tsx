"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Send,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link as LinkIcon,
  Paperclip,
  Palette,
  RemoveFormatting,
  AlertTriangle,
  CheckCircle2,
  Shield,
} from "lucide-react";
import {
  createDraftReq,
  discardDraftReq,
  updateDraftReq,
  requestApprovalReq,
  decideApprovalReq,
  requestAiDraftReq,
} from "@/lib/inbox/client";
import { cn } from "@/lib/utils";
import type { DraftDTO } from "@/lib/inbox/types";

export type ComposerInitial = {
  draftId?: string | null;
  threadId?: string | null;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  htmlBody?: string;
  originType?: "ai_employee" | "human";
  requiresApproval?: boolean;
  isStale?: boolean;
  staleReason?: string | null;
  approvalStatus?: DraftDTO["approvalStatus"];
  approvalId?: string | null;
  approvalExpiresAt?: string | null;
  employeeId?: string | null;
  mailboxAddress?: string;
  canApprove?: boolean;
};

export type ComposerAttachment = {
  id: string;
  filename: string;
  contentBase64: string;
  contentType: string;
  sizeBytes: number;
};

export type SendPayload = {
  clientSendId: string;
  draftId: string | null;
  threadId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  htmlBody: string;
  attachments: Array<{
    filename: string;
    contentBase64: string;
    contentType: string;
  }>;
};

const TEXT_COLORS = [
  { label: "Default", value: "" },
  { label: "Ink", value: "#1a1a1a" },
  { label: "Blue", value: "#2F6FED" },
  { label: "Green", value: "#1B7A4A" },
  { label: "Amber", value: "#B45309" },
  { label: "Red", value: "#C0392B" },
  { label: "Gray", value: "#6B7280" },
];

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function parseAddresses(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function htmlToText(html: string): string {
  if (typeof document === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const el = document.createElement("div");
  el.innerHTML = html;
  return (el.innerText || el.textContent || "").trim();
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function Composer({
  workspaceId,
  initial,
  onSend,
  onClose,
  onDraftChange,
}: {
  workspaceId: string;
  initial: ComposerInitial;
  onSend: (payload: SendPayload) => void;
  onClose: () => void;
  onDraftChange?: (draft: DraftDTO | null) => void;
}) {
  const [to, setTo] = useState((initial.to ?? []).join(", "));
  const [cc, setCc] = useState((initial.cc ?? []).join(", "));
  const [bcc, setBcc] = useState((initial.bcc ?? []).join(", "));
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [showCc, setShowCc] = useState((initial.cc?.length ?? 0) + (initial.bcc?.length ?? 0) > 0);
  const [draftId, setDraftId] = useState<string | null>(initial.draftId ?? null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [colorOpen, setColorOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [originType] = useState(initial.originType ?? "human");
  const [requiresApproval, setRequiresApproval] = useState(
    Boolean(initial.requiresApproval || initial.originType === "ai_employee"),
  );
  const [isStale] = useState(Boolean(initial.isStale));
  const [staleReason] = useState(initial.staleReason ?? null);
  const [approvalStatus, setApprovalStatus] = useState(initial.approvalStatus ?? "none");
  const [approvalId, setApprovalId] = useState<string | null>(initial.approvalId ?? null);
  const [approvalExpiresAt, setApprovalExpiresAt] = useState<string | null>(
    initial.approvalExpiresAt ?? null,
  );
  const [approvalEnvelope, setApprovalEnvelope] = useState<{
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
  } | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const draftIdRef = useRef<string | null>(initial.draftId ?? null);
  const threadId = initial.threadId ?? null;
  const seededRef = useRef(false);

  // Seed editor once.
  useEffect(() => {
    if (seededRef.current || !editorRef.current) return;
    seededRef.current = true;
    const html =
      initial.htmlBody?.trim() ||
      (initial.body
        ? initial.body
            .split(/\n{2,}/)
            .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
            .join("")
        : "");
    editorRef.current.innerHTML = html || "<p><br/></p>";
  }, [initial.htmlBody, initial.body]);

  const readEditor = useCallback(() => {
    const html = editorRef.current?.innerHTML ?? "";
    const text = htmlToText(html);
    return { html, text };
  }, []);

  const snapshot = useCallback(() => {
    const { html, text } = readEditor();
    return {
      to: parseAddresses(to),
      cc: parseAddresses(cc),
      bcc: parseAddresses(bcc),
      subject: subject.trim(),
      textBody: text,
      htmlBody: html,
    };
  }, [to, cc, bcc, subject, readEditor]);

  const persist = useCallback(async () => {
    const data = snapshot();
    const isEmpty =
      data.to.length === 0 &&
      !data.subject &&
      !data.textBody.trim() &&
      data.cc.length === 0 &&
      attachments.length === 0;
    if (isEmpty || savingRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      let draft: DraftDTO;
      if (draftIdRef.current) {
        draft = await updateDraftReq({
          draftId: draftIdRef.current,
          workspaceId,
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
          subject: data.subject,
          textBody: data.textBody,
          htmlBody: data.htmlBody,
        });
      } else {
        draft = await createDraftReq({
          workspaceId,
          threadId,
          to: data.to,
          cc: data.cc,
          bcc: data.bcc,
          subject: data.subject,
          textBody: data.textBody,
          htmlBody: data.htmlBody,
        });
        draftIdRef.current = draft.id;
        setDraftId(draft.id);
      }
      onDraftChange?.(draft);
      setSaveState("saved");
    } catch {
      setSaveState("idle");
    } finally {
      savingRef.current = false;
    }
  }, [snapshot, workspaceId, threadId, onDraftChange, attachments.length]);

  const schedulePersist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 2500);
  }, [persist]);

  useEffect(() => {
    schedulePersist();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [to, cc, bcc, subject, schedulePersist]);

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    schedulePersist();
  };

  const applyLink = () => {
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    exec("createLink", url);
  };

  const addFiles = async (files: FileList | File[]) => {
    setAttachError(null);
    const list = Array.from(files);
    for (const file of list) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachError(`“${file.name}” is larger than 8 MB.`);
        continue;
      }
      try {
        const contentBase64 = await fileToBase64(file);
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            filename: file.name,
            contentBase64,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          },
        ]);
      } catch {
        setAttachError(`Could not attach “${file.name}”.`);
      }
    }
    schedulePersist();
  };

  const emitSend = () => {
    const data = snapshot();
    onSend({
      clientSendId: crypto.randomUUID(),
      draftId: draftIdRef.current,
      threadId,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      body: data.textBody,
      htmlBody: data.htmlBody || `<p>${data.textBody.replace(/\n/g, "<br/>")}</p>`,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        contentBase64: a.contentBase64,
        contentType: a.contentType,
      })),
    });
    onClose();
  };

  const handleSend = () => {
    const data = snapshot();
    if (data.to.length === 0) return;
    setGateError(null);
    if (isStale) {
      setGateError("Draft is outdated. Regenerate before sending.");
      return;
    }
    if (requiresApproval && approvalStatus !== "approved") {
      if (initial.canApprove) {
        void handleApproveAndSend();
        return;
      }
      setGateError("This AI draft still needs approval before send.");
      return;
    }
    emitSend();
  };

  /** Approvers: one click creates/locks approval, decides approve, and sends. */
  const handleApproveAndSend = async () => {
    const data = snapshot();
    if (data.to.length === 0) return;
    if (isStale) {
      setGateError("Draft is outdated. Regenerate before sending.");
      return;
    }
    setApprovalBusy(true);
    setGateError(null);
    try {
      if (!draftIdRef.current) await persist();
      if (!draftIdRef.current) {
        setGateError("Save the draft before sending.");
        return;
      }

      let nextApprovalId = approvalId;
      if (approvalStatus !== "approved") {
        if (approvalStatus !== "pending" || !nextApprovalId) {
          const res = await requestApprovalReq({
            workspaceId,
            draftId: draftIdRef.current,
          });
          nextApprovalId = res.approvalId;
          setApprovalId(res.approvalId);
          setApprovalExpiresAt(res.expiresAt);
          setApprovalEnvelope(res.envelope);
          setApprovalStatus("pending");
          setRequiresApproval(true);
        }
        if (!nextApprovalId) {
          setGateError("Could not create approval.");
          return;
        }
        await decideApprovalReq({
          workspaceId,
          approvalId: nextApprovalId,
          decision: "approve",
        });
        setApprovalStatus("approved");
      }

      emitSend();
    } catch (err) {
      setGateError(err instanceof Error ? err.message : "Could not approve and send.");
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleRequestApproval = async () => {
    if (!draftIdRef.current) {
      await persist();
    }
    if (!draftIdRef.current) {
      setGateError("Save the draft before requesting approval.");
      return;
    }
    setApprovalBusy(true);
    setGateError(null);
    try {
      const res = await requestApprovalReq({
        workspaceId,
        draftId: draftIdRef.current,
      });
      setApprovalId(res.approvalId);
      setApprovalExpiresAt(res.expiresAt);
      setApprovalEnvelope(res.envelope);
      setApprovalStatus("pending");
      setRequiresApproval(true);
    } catch (err) {
      setGateError(err instanceof Error ? err.message : "Could not request approval.");
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleDecideApproval = async (decision: "approve" | "reject") => {
    if (!approvalId) return;
    setApprovalBusy(true);
    setGateError(null);
    try {
      await decideApprovalReq({ workspaceId, approvalId, decision });
      setApprovalStatus(decision === "approve" ? "approved" : "rejected");
    } catch (err) {
      setGateError(err instanceof Error ? err.message : "Could not update approval.");
    } finally {
      setApprovalBusy(false);
    }
  };

  const handleRewrite = async (rewriteType: "shorter" | "warmer" | "persuasive") => {
    if (!threadId) return;
    setRewriteBusy(true);
    setGateError(null);
    try {
      await requestAiDraftReq({
        workspaceId,
        threadId,
        draftId: draftIdRef.current,
        employeeId: initial.employeeId ?? undefined,
        rewriteType,
      });
      setApprovalStatus("none");
      setApprovalId(null);
      setGateError("Rewrite queued — reopen the draft when ready.");
    } catch (err) {
      setGateError(err instanceof Error ? err.message : "Rewrite failed.");
    } finally {
      setRewriteBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (draftIdRef.current) {
      await discardDraftReq({ draftId: draftIdRef.current, workspaceId }).catch(() => {});
      onDraftChange?.(null);
    }
    onClose();
  };

  const mailboxDomain = (initial.mailboxAddress ?? "").split("@")[1]?.toLowerCase() ?? "";
  const externalRecipients = parseAddresses(to)
    .concat(parseAddresses(cc), parseAddresses(bcc))
    .filter((addr) => {
      const domain = addr.split("@")[1]?.toLowerCase();
      return domain && mailboxDomain && domain !== mailboxDomain;
    });

  const needsApproverGate =
    requiresApproval && approvalStatus !== "approved" && !initial.canApprove;
  const sendBlocked =
    parseAddresses(to).length === 0 || isStale || needsApproverGate || approvalBusy;
  const showApproveAndSend =
    Boolean(initial.canApprove) &&
    (requiresApproval || originType === "ai_employee") &&
    approvalStatus !== "approved";

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border-2 px-4 py-2">
        <span className="text-sm font-medium text-ink">
          {threadId ? "Reply" : "New message"}
          {originType === "ai_employee" && (
            <span className="ml-2 text-xs font-normal text-ink-3">
              {initial.canApprove ? "AI draft · review & send" : "AI draft · needs approval"}
            </span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-3">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : ""}
          </span>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-muted" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isStale && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{staleReason || "This draft is outdated."}</p>
            {threadId && (
              <button
                type="button"
                disabled={rewriteBusy}
                onClick={() => {
                  void (async () => {
                    setRewriteBusy(true);
                    try {
                      await requestAiDraftReq({
                        workspaceId,
                        threadId,
                        draftId: draftIdRef.current,
                        employeeId: initial.employeeId ?? undefined,
                      });
                      setGateError("Regenerate queued — reopen the draft when ready.");
                    } catch (err) {
                      setGateError(err instanceof Error ? err.message : "Regenerate failed.");
                    } finally {
                      setRewriteBusy(false);
                    }
                  })();
                }}
                className="mt-1 font-medium underline"
              >
                Regenerate
              </button>
            )}
          </div>
        </div>
      )}

      {(requiresApproval || originType === "ai_employee") && (
        <div className="shrink-0 space-y-2 border-b border-border bg-canvas px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              <Shield className="h-3.5 w-3.5" />
              {initial.canApprove ? "Review before send" : "Approval required"}
            </div>
            {externalRecipients.length > 0 && (
              <p className="text-[11px] text-amber-800">
                External: {externalRecipients.join(", ")}
              </p>
            )}
          </div>
          <p className="text-xs text-ink-2">
            From {(approvalEnvelope?.from || initial.mailboxAddress) ?? "workspace mailbox"}
            {approvalStatus === "approved" && (
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Approved
              </span>
            )}
          </p>
          {!initial.canApprove && (
            <div className="flex flex-wrap gap-2">
              {approvalStatus !== "approved" && approvalStatus !== "pending" && (
                <button
                  type="button"
                  disabled={approvalBusy || isStale}
                  onClick={() => void handleRequestApproval()}
                  className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  Request approval
                </button>
              )}
              {approvalStatus === "pending" && (
                <span className="text-xs text-ink-3">Waiting for an approver…</span>
              )}
            </div>
          )}
          {initial.canApprove && approvalStatus === "pending" && (
            <button
              type="button"
              disabled={approvalBusy}
              onClick={() => void handleDecideApproval("reject")}
              className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Reject draft
            </button>
          )}
        </div>
      )}

      <div className="flex shrink-0 flex-col gap-px">
        <Field label="To">
          <input
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              if (requiresApproval && approvalStatus === "approved") setApprovalStatus("none");
            }}
            onBlur={() => void persist()}
            placeholder="name@example.com"
            className="w-full bg-transparent text-sm text-ink outline-none"
          />
          {!showCc && (
            <button
              type="button"
              onClick={() => setShowCc(true)}
              className="shrink-0 text-xs text-ink-3 hover:text-ink"
            >
              Cc/Bcc
            </button>
          )}
        </Field>
        {showCc && (
          <>
            <Field label="Cc">
              <input
                value={cc}
                onChange={(e) => {
                  setCc(e.target.value);
                  if (requiresApproval && approvalStatus === "approved") setApprovalStatus("none");
                }}
                onBlur={() => void persist()}
                className="w-full bg-transparent text-sm text-ink outline-none"
              />
            </Field>
            <Field label="Bcc">
              <input
                value={bcc}
                onChange={(e) => {
                  setBcc(e.target.value);
                  if (requiresApproval && approvalStatus === "approved") setApprovalStatus("none");
                }}
                onBlur={() => void persist()}
                className="w-full bg-transparent text-sm text-ink outline-none"
              />
            </Field>
          </>
        )}
        <Field label="Subject">
          <input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              if (requiresApproval && approvalStatus === "approved") setApprovalStatus("none");
            }}
            onBlur={() => void persist()}
            aria-label="Subject"
            placeholder="Subject"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3/50"
          />
        </Field>
      </div>

      {/* Formatting toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border-2 px-2 py-1.5">
        <ToolBtn label="Bold" onClick={() => exec("bold")}>
          <Bold className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Italic" onClick={() => exec("italic")}>
          <Italic className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Underline" onClick={() => exec("underline")}>
          <Underline className="h-3.5 w-3.5" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolBtn label="Bulleted list" onClick={() => exec("insertUnorderedList")}>
          <List className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Numbered list" onClick={() => exec("insertOrderedList")}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn label="Link" onClick={applyLink}>
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolBtn>
        <div className="relative">
          <ToolBtn label="Text color" onClick={() => setColorOpen((o) => !o)}>
            <Palette className="h-3.5 w-3.5" />
          </ToolBtn>
          {colorOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-lg border border-border bg-surface p-2 shadow-md">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  title={c.label}
                  onClick={() => {
                    if (!c.value) exec("removeFormat");
                    else exec("foreColor", c.value);
                    setColorOpen(false);
                  }}
                  className="h-5 w-5 rounded-full border border-border"
                  style={{ background: c.value || "#fff" }}
                />
              ))}
            </div>
          )}
        </div>
        <ToolBtn label="Clear formatting" onClick={() => exec("removeFormat")}>
          <RemoveFormatting className="h-3.5 w-3.5" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolBtn label="Attach file" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="h-3.5 w-3.5" />
        </ToolBtn>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {originType === "ai_employee" && threadId && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            {(["shorter", "warmer", "persuasive"] as const).map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={rewriteBusy}
                onClick={() => void handleRewrite(chip)}
                className="rounded-md px-2 py-1 text-[11px] capitalize text-ink-3 hover:bg-muted hover:text-ink disabled:opacity-40"
              >
                {chip}
              </button>
            ))}
          </>
        )}
      </div>

      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline
        aria-label="Message body"
        data-placeholder="Write your message…"
        onInput={() => {
          schedulePersist();
          if (requiresApproval && approvalStatus === "approved") setApprovalStatus("none");
        }}
        onBlur={() => void persist()}
        onPaste={(e) => {
          if (e.clipboardData.files.length > 0) {
            e.preventDefault();
            void addFiles(e.clipboardData.files);
          }
        }}
        className={cn(
          "min-h-[200px] flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed text-ink outline-none",
          "[&_a]:text-accent [&_a]:underline",
          "empty:before:pointer-events-none empty:before:text-ink-3 empty:before:content-[attr(data-placeholder)]",
        )}
        style={{ whiteSpace: "pre-wrap" }}
      />

      {attachments.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-border-2 px-4 py-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-ink-2"
            >
              <Paperclip className="h-3 w-3" />
              <span className="max-w-[140px] truncate">{a.filename}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                className="text-ink-3 hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {attachError && <p className="px-4 pb-1 text-xs text-rose-600">{attachError}</p>}
      {gateError && <p className="px-4 pb-1 text-xs text-rose-600">{gateError}</p>}

      <div className="flex shrink-0 items-center justify-between border-t border-border-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => {
            if (showApproveAndSend) void handleApproveAndSend();
            else handleSend();
          }}
          disabled={sendBlocked}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
          {approvalBusy ? "Working…" : showApproveAndSend ? "Approve & send" : "Send"}
        </button>
        <button type="button" onClick={handleDiscard} className="text-xs text-ink-3 hover:text-rose-600">
          Discard
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border-2 px-4 py-2">
      <span className="w-12 shrink-0 text-xs font-medium text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function ToolBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-ink-3 transition hover:bg-muted hover:text-ink"
    >
      {children}
    </button>
  );
}
