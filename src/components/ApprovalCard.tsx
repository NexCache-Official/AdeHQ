"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Approval } from "@/lib/types";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { parseJsonResponse } from "@/lib/api/parse-json-response";
import { ActorChip } from "./ActorChip";
import { RISK_META } from "@/lib/icons";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "./ui";
import {
  Check,
  ExternalLink,
  Loader2,
  Mail,
  MessageCircleWarning,
  Pencil,
  ShieldAlert,
  X,
} from "lucide-react";
import { motion } from "framer-motion";

const ACTION_LABEL: Record<Approval["actionType"], string> = {
  tool_access: "Tool access",
  memory_pin: "Pin to memory",
  task_creation: "Create tasks",
  external_action: "External action",
  tool_execution: "Tool action",
};

type ResolveAction = "approve" | "edit" | "reject" | "revise";

type ResolveResponse = {
  approval?: Approval & { actionPayload?: Record<string, unknown> };
  execution?: {
    status: string;
    error?: string;
    output?: { summary?: string };
  };
  revisionReplyFailed?: string;
  error?: string;
};

function StatusBadge({ status }: { status: Approval["status"] }) {
  if (status === "pending") return null;
  const meta =
    status === "approved"
      ? { label: "Approved", className: "bg-emerald-500/15 text-emerald-700" }
      : status === "rejected"
        ? { label: "Rejected", className: "bg-rose-500/15 text-rose-600" }
        : { label: "Revision requested", className: "bg-amber-500/15 text-amber-700" };
  return (
    <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", meta.className)}>
      {meta.label}
    </span>
  );
}

/** Editable arg fields — primitive values become inputs, long text a textarea. */
function editableArgEntries(args: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(args)
    .filter(([key, value]) => {
      if (!["string", "number", "boolean"].includes(typeof value)) return false;
      // Prefer full `body` over truncated preview for email edits.
      if (key === "bodyPreview" && typeof args.body === "string") return false;
      if (key === "draftId") return false;
      return true;
    })
    .map(([key, value]) => [key, String(value)] as [string, string]);
}

function fieldValue(
  fields: Array<{ label: string; value: string }> | undefined,
  label: string,
): string {
  return fields?.find((f) => f.label.toLowerCase() === label.toLowerCase())?.value ?? "";
}

export function ApprovalCard({ approval }: { approval: Approval }) {
  const { state, actions } = useStore();
  const risk = RISK_META[approval.risk] ?? RISK_META.medium;
  const room = state.rooms.find((r) => r.id === approval.roomId);
  const resolved = approval.status !== "pending";
  const isDemoWorkspace = state.workspace.workspaceMode === "demo";
  const hasActionPayload = Boolean(approval.actionPayload?.tool);
  const toolName =
    typeof approval.actionPayload?.tool === "string" ? approval.actionPayload.tool : "";
  const isEmailSend = toolName === "email.sendDraft";
  const isCapabilityGrant =
    approval.actionType === "tool_access" &&
    approval.actionPayload?.kind === "capability_grant";

  const [busyAction, setBusyAction] = useState<ResolveAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<"edit" | "revise" | null>(null);
  const [note, setNote] = useState("");
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  const previewFields = approval.previewSnapshot?.fields ?? [];
  const payloadArgs = useMemo(
    () => (approval.actionPayload?.args as Record<string, unknown> | undefined) ?? {},
    [approval.actionPayload],
  );
  const editEntries = useMemo(() => editableArgEntries(payloadArgs), [payloadArgs]);

  const emailTo =
    (typeof payloadArgs.recipientEmail === "string" && payloadArgs.recipientEmail) ||
    fieldValue(previewFields, "To");
  const emailSubject =
    (typeof payloadArgs.subject === "string" && payloadArgs.subject) ||
    fieldValue(previewFields, "Subject");
  const emailBody =
    (typeof payloadArgs.body === "string" && payloadArgs.body) ||
    (typeof payloadArgs.bodyPreview === "string" && payloadArgs.bodyPreview) ||
    fieldValue(previewFields, "Body") ||
    fieldValue(previewFields, "Preview");
  const draftId = typeof payloadArgs.draftId === "string" ? payloadArgs.draftId : null;

  // Keep pending email cards fresh against inbox draft status / full body.
  useEffect(() => {
    if (!isEmailSend || resolved) return;
    void actions.ensureApproval(approval.id);
    const t = window.setInterval(() => {
      void actions.ensureApproval(approval.id);
    }, 8000);
    return () => window.clearInterval(t);
  }, [actions, approval.id, isEmailSend, resolved]);

  async function resolveOnServer(
    action: ResolveAction,
    grantScope?: "once" | "always",
  ) {
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { action };
      if (grantScope) body.grantScope = grantScope;
      if (action === "revise" || note.trim()) body.note = note.trim();
      if (action === "edit") {
        const editedArgs: Record<string, unknown> = { ...payloadArgs };
        for (const [key, raw] of Object.entries(editedValues)) {
          const original = payloadArgs[key];
          editedArgs[key] =
            typeof original === "number"
              ? Number(raw)
              : typeof original === "boolean"
                ? raw === "true"
                : raw;
        }
        // Map UI "body" onto both body + bodyPreview for schema + draft update.
        if (typeof editedArgs.body === "string") {
          editedArgs.bodyPreview = editedArgs.body;
        }
        body.editedArgs = editedArgs;
      }

      const response = await fetch(`/api/approvals/${approval.id}/resolve`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await parseJsonResponse<
        ResolveResponse & { acknowledgment?: string }
      >(response);
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to resolve approval.");
      }

      if (data.approval) {
        actions.mergeApproval({ ...approval, ...data.approval });
      }
      if (data.acknowledgment) {
        setNotice(data.acknowledgment);
      } else if (data.execution) {
        if (data.execution.status === "success") {
          setNotice(data.execution.output?.summary ?? "Action executed.");
        } else if (data.execution.error) {
          setError(`Approved, but execution failed: ${data.execution.error}`);
        }
      }
      if (data.revisionReplyFailed) setNotice(data.revisionReplyFailed);
      setPanel(null);
      void actions.refreshWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resolve approval.");
    } finally {
      setBusyAction(null);
    }
  }

  function resolve(action: ResolveAction) {
    // Demo workspaces keep the legacy local behavior.
    if (isDemoWorkspace) {
      actions.resolveApproval(approval.id, action !== "reject");
      return;
    }
    void resolveOnServer(action);
  }

  const busy = busyAction !== null;
  const nonBodyFields = previewFields.filter(
    (f) => !["Body", "Preview"].includes(f.label),
  );

  if (isEmailSend) {
    return (
      <motion.div
        layout
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-surface shadow-sm",
          resolved && "opacity-80",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-d">
              <Mail className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                  Email send
                </span>
                {!resolved && (
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", risk.bg, risk.color)}>
                    Needs approval
                  </span>
                )}
                <StatusBadge status={approval.status} />
              </div>
              <h4 className="mt-0.5 truncate text-sm font-semibold text-ink">
                {emailSubject || approval.title}
              </h4>
            </div>
          </div>
          {draftId && (
            <Link
              href={`/inbox?folder=drafts`}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent-d hover:underline"
            >
              Inbox <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>

        <div className="space-y-0 border-b border-border px-4 py-3">
          <div className="grid gap-2 text-xs">
            <div className="flex gap-3 min-w-0">
              <span className="w-14 shrink-0 font-medium text-ink-3">To</span>
              <span className="min-w-0 break-all font-medium text-ink">{emailTo || "—"}</span>
            </div>
            <div className="flex gap-3 min-w-0">
              <span className="w-14 shrink-0 font-medium text-ink-3">Subject</span>
              <span className="min-w-0 text-ink">{emailSubject || "—"}</span>
            </div>
          </div>
        </div>

        {panel !== "edit" && (
          <div className="max-h-64 overflow-y-auto px-4 py-3">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
              {emailBody || "No email body available."}
            </p>
          </div>
        )}

        {approval.resolutionNote && (
          <p className="border-t border-border px-4 py-2 text-[11px] italic text-ink-3">
            Note: {approval.resolutionNote}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <ActorChip id={approval.requestedBy} />
          </div>
          <span className="text-[11px] text-ink-3">
            {room?.name} · {timeAgo(approval.createdAt)}
          </span>
        </div>

        {error && <p className="px-4 pb-2 text-[11px] font-medium text-rose-600">{error}</p>}
        {notice && <p className="px-4 pb-2 text-[11px] font-medium text-emerald-700">{notice}</p>}

        {!resolved && panel === "edit" && (
          <div className="space-y-2 border-t border-border px-4 py-3">
            <p className="text-[11px] font-medium text-ink-2">Edit email before approving</p>
            <label className="block text-[11px] text-ink-3">
              <span className="mb-0.5 block">To</span>
              <input
                value={editedValues.recipientEmail ?? emailTo}
                onChange={(e) =>
                  setEditedValues((v) => ({ ...v, recipientEmail: e.target.value }))
                }
                className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink"
              />
            </label>
            <label className="block text-[11px] text-ink-3">
              <span className="mb-0.5 block">Subject</span>
              <input
                value={editedValues.subject ?? emailSubject}
                onChange={(e) => setEditedValues((v) => ({ ...v, subject: e.target.value }))}
                className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink"
              />
            </label>
            <label className="block text-[11px] text-ink-3">
              <span className="mb-0.5 block">Body</span>
              <textarea
                value={editedValues.body ?? emailBody}
                rows={12}
                onChange={(e) => setEditedValues((v) => ({ ...v, body: e.target.value }))}
                className="min-h-[220px] w-full resize-y rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs leading-relaxed text-ink"
              />
            </label>
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="flex-1" disabled={busy} onClick={() => resolve("edit")}>
                {busyAction === "edit" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve & send
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!resolved && panel === "revise" && (
          <div className="space-y-2 border-t border-border px-4 py-3">
            <p className="text-[11px] font-medium text-ink-2">What should change?</p>
            <textarea
              value={note}
              rows={3}
              placeholder="e.g. Soften the ask and mention the Friday deadline"
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink"
            />
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1"
                disabled={busy || !note.trim()}
                onClick={() => resolve("revise")}
              >
                {busyAction === "revise" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircleWarning className="h-4 w-4" />
                )}
                Send back for revision
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!resolved && panel === null && (
          <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
            <Button size="sm" className="flex-1" disabled={busy} onClick={() => resolve("approve")}>
              {busyAction === "approve" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Approve & send
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setEditedValues({
                  recipientEmail: emailTo,
                  subject: emailSubject,
                  body: emailBody,
                });
                setPanel("edit");
              }}
            >
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPanel("revise")}>
              <MessageCircleWarning className="h-4 w-4" /> Revise
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => resolve("reject")}>
              {busyAction === "reject" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              Reject
            </Button>
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      className={cn(
        "rounded-xl border border-border bg-surface p-4 shadow-sm",
        resolved ? "opacity-70" : risk.border,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", risk.bg, risk.color)}>
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div>
            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", risk.bg, risk.color)}>
              {risk.label}
            </span>
            <span className="ml-1.5 text-[10px] text-ink-3">
              {ACTION_LABEL[approval.actionType] ?? "Action"}
            </span>
          </div>
        </div>
        <StatusBadge status={approval.status} />
      </div>

      <h4 className="mt-2.5 text-sm font-semibold text-ink">{approval.title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{approval.description}</p>

      {nonBodyFields.length > 0 && (
        <dl className="mt-3 space-y-1 rounded-xl border border-border bg-canvas px-3 py-2.5">
          {nonBodyFields.map((field) => (
            <div key={field.label} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="shrink-0 text-ink-3">{field.label}</dt>
              <dd className="text-right font-medium text-ink-2">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {approval.resolutionNote && (
        <p className="mt-2 text-[11px] italic text-ink-3">Note: {approval.resolutionNote}</p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <ActorChip id={approval.requestedBy} />
        </div>
        <span className="text-[11px] text-ink-3">
          {room?.name} · {timeAgo(approval.createdAt)}
          {approval.revisionCount ? ` · rev ${approval.revisionCount}` : ""}
        </span>
      </div>

      {error && <p className="mt-2 text-[11px] font-medium text-rose-600">{error}</p>}
      {notice && <p className="mt-2 text-[11px] font-medium text-emerald-700">{notice}</p>}

      {!resolved && panel === "edit" && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-canvas p-3">
          <p className="text-[11px] font-medium text-ink-2">Edit before approving</p>
          {editEntries.map(([key, value]) => {
            const current = editedValues[key] ?? value;
            const isLong = value.length > 64 || key === "body" || key === "bodyPreview";
            return (
              <label key={key} className="block text-[11px] text-ink-3">
                <span className="mb-0.5 block capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                {isLong ? (
                  <textarea
                    value={current}
                    rows={key === "body" || key === "bodyPreview" ? 10 : 3}
                    onChange={(e) => setEditedValues((v) => ({ ...v, [key]: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
                  />
                ) : (
                  <input
                    value={current}
                    onChange={(e) => setEditedValues((v) => ({ ...v, [key]: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
                  />
                )}
              </label>
            );
          })}
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1" disabled={busy} onClick={() => resolve("edit")}>
              {busyAction === "edit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve with edits
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!resolved && panel === "revise" && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-canvas p-3">
          <p className="text-[11px] font-medium text-ink-2">What should change?</p>
          <textarea
            value={note}
            rows={2}
            placeholder="e.g. Lower the amount to £3,000 and set stage to Proposal"
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
          />
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1"
              disabled={busy || !note.trim()}
              onClick={() => resolve("revise")}
            >
              {busyAction === "revise" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageCircleWarning className="h-4 w-4" />
              )}
              Send back for revision
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!resolved && panel === null && isCapabilityGrant && (
        <div className="mt-3.5 flex flex-wrap gap-2 border-t border-border pt-3.5">
          <Button
            size="sm"
            className="flex-1"
            disabled={busy}
            onClick={() => {
              if (isDemoWorkspace) {
                actions.resolveApproval(approval.id, true);
                return;
              }
              void resolveOnServer("approve", "once");
            }}
          >
            {busyAction === "approve" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Allow once
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={() => {
              if (isDemoWorkspace) {
                actions.resolveApproval(approval.id, true);
                return;
              }
              void resolveOnServer("approve", "always");
            }}
          >
            Always allow
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={() => resolve("reject")}
          >
            {busyAction === "reject" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Not now
          </Button>
        </div>
      )}

      {!resolved && panel === null && !isCapabilityGrant && (
        <div className="mt-3.5 flex flex-wrap gap-2 border-t border-border pt-3.5">
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => resolve("approve")}>
            {busyAction === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve
          </Button>
          {!isDemoWorkspace && hasActionPayload && editEntries.length > 0 && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPanel("edit")}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
          {!isDemoWorkspace && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPanel("revise")}>
              <MessageCircleWarning className="h-4 w-4" /> Revise
            </Button>
          )}
          <Button size="sm" variant="secondary" className="flex-1" disabled={busy} onClick={() => resolve("reject")}>
            {busyAction === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject
          </Button>
        </div>
      )}
    </motion.div>
  );
}
