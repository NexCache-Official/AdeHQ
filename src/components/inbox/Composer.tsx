"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Send } from "lucide-react";
import { createDraftReq, discardDraftReq, updateDraftReq } from "@/lib/inbox/client";
import type { DraftDTO } from "@/lib/inbox/types";

export type ComposerInitial = {
  draftId?: string | null;
  threadId?: string | null;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
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
};

function parseAddresses(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
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
  const [body, setBody] = useState(initial.body ?? "");
  const [showCc, setShowCc] = useState((initial.cc?.length ?? 0) + (initial.bcc?.length ?? 0) > 0);
  const [draftId, setDraftId] = useState<string | null>(initial.draftId ?? null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const draftIdRef = useRef<string | null>(initial.draftId ?? null);
  const threadId = initial.threadId ?? null;

  const snapshot = useCallback(
    () => ({
      to: parseAddresses(to),
      cc: parseAddresses(cc),
      bcc: parseAddresses(bcc),
      subject: subject.trim(),
      textBody: body,
    }),
    [to, cc, bcc, subject, body],
  );

  const persist = useCallback(async () => {
    const data = snapshot();
    const isEmpty =
      data.to.length === 0 && !data.subject && !data.textBody.trim() && data.cc.length === 0;
    if (isEmpty || savingRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      let draft: DraftDTO;
      if (draftIdRef.current) {
        draft = await updateDraftReq({ draftId: draftIdRef.current, workspaceId, ...data });
      } else {
        draft = await createDraftReq({ workspaceId, threadId, ...data });
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
  }, [snapshot, workspaceId, threadId, onDraftChange]);

  // Debounced autosave on any field change.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 2500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, body]);

  const handleSend = () => {
    const data = snapshot();
    if (data.to.length === 0) return;
    onSend({
      clientSendId: crypto.randomUUID(),
      draftId: draftIdRef.current,
      threadId,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      body: data.textBody,
    });
    onClose();
  };

  const handleDiscard = async () => {
    if (draftIdRef.current) {
      await discardDraftReq({ draftId: draftIdRef.current, workspaceId }).catch(() => {});
      onDraftChange?.(null);
    }
    onClose();
  };

  return (
    <div className="flex min-h-0 flex-col border-t border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border-2 px-4 py-2">
        <span className="text-sm font-medium text-ink">
          {threadId ? "Reply" : "New message"}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-3">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : ""}
          </span>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-px overflow-y-auto">
        <Field label="To">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={persist}
            placeholder="name@example.com"
            className="w-full bg-transparent text-sm text-ink outline-none"
          />
          {!showCc && (
            <button
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
                onChange={(e) => setCc(e.target.value)}
                onBlur={persist}
                className="w-full bg-transparent text-sm text-ink outline-none"
              />
            </Field>
            <Field label="Bcc">
              <input
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                onBlur={persist}
                className="w-full bg-transparent text-sm text-ink outline-none"
              />
            </Field>
          </>
        )}
        <Field label="Subject">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={persist}
            className="w-full bg-transparent text-sm text-ink outline-none"
          />
        </Field>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={persist}
        placeholder="Write your message…"
        rows={8}
        className="min-h-[120px] flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-relaxed text-ink outline-none"
      />

      <div className="flex items-center justify-between border-t border-border-2 px-4 py-2.5">
        <button
          onClick={handleSend}
          disabled={parseAddresses(to).length === 0}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" /> Send
        </button>
        <button
          onClick={handleDiscard}
          className="text-xs text-ink-3 hover:text-rose-600"
        >
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
