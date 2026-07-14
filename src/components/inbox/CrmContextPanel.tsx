"use client";

import { useState } from "react";
import { Building2, UserRound, Briefcase, CalendarClock, Loader2 } from "lucide-react";
import {
  inboxCreateContact,
  inboxCreateFollowUp,
  inboxDetachContact,
  newClientActionId,
} from "@/lib/inbox/client";

type CrmPayload = {
  contact: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    companyName: string | null;
    companyId: string | null;
  } | null;
  deal: {
    id: string;
    name: string;
    stageName: string;
    amount: number | null;
    status: string;
  } | null;
  suggestedContact: { email: string; name: string | null } | null;
  openFollowUps: Array<{
    taskId: string;
    title: string;
    dueDate: string | null;
    status: string;
  }>;
};

export function CrmContextPanel({
  workspaceId,
  threadId,
  canOrganize,
  crm,
  rooms,
  onChanged,
}: {
  workspaceId: string;
  threadId: string;
  canOrganize: boolean;
  crm: CrmPayload;
  rooms: Array<{ id: string; name: string }>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followRoomId, setFollowRoomId] = useState(rooms[0]?.id ?? "");
  const [followTitle, setFollowTitle] = useState("Follow up");
  const [followDue, setFollowDue] = useState("");
  const [showFollow, setShowFollow] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-b border-border px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        CRM
      </p>
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </p>
      )}

      {crm.contact ? (
        <div className="rounded-xl border border-border bg-canvas px-3 py-2.5">
          <div className="flex items-start gap-2">
            <UserRound className="mt-0.5 h-4 w-4 text-accent-d" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{crm.contact.name}</p>
              <p className="text-xs text-ink-3">{crm.contact.email || "—"}</p>
              {crm.contact.phone && (
                <p className="text-xs text-ink-3">{crm.contact.phone}</p>
              )}
              {crm.contact.companyName && (
                <p className="mt-1 flex items-center gap-1 text-xs text-ink-2">
                  <Building2 className="h-3 w-3" />
                  {crm.contact.companyName}
                </p>
              )}
              {canOrganize && (
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 text-[11px] font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
                  onClick={() =>
                    void run(() =>
                      inboxDetachContact({
                        workspaceId,
                        threadId,
                        clientActionId: newClientActionId(),
                      }),
                    )
                  }
                >
                  Unlink contact
                </button>
              )}
            </div>
          </div>
        </div>
      ) : crm.suggestedContact && canOrganize ? (
        <div className="rounded-xl border border-dashed border-border px-3 py-2.5">
          <p className="text-xs text-ink-2">
            No CRM contact for{" "}
            <span className="font-medium text-ink">{crm.suggestedContact.email}</span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() =>
                inboxCreateContact({
                  workspaceId,
                  threadId,
                  clientActionId: newClientActionId(),
                  email: crm.suggestedContact!.email,
                  firstName: crm.suggestedContact!.name ?? undefined,
                }),
              )
            }
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Create contact from sender"
            )}
          </button>
        </div>
      ) : (
        <p className="text-xs text-ink-3">No contact linked.</p>
      )}

      {crm.deal ? (
        <div className="rounded-xl border border-border bg-canvas px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Briefcase className="mt-0.5 h-4 w-4 text-accent-d" />
            <div>
              <p className="font-medium text-ink">{crm.deal.name}</p>
              <p className="text-xs text-ink-3">
                {crm.deal.stageName}
                {crm.deal.amount != null
                  ? ` · ${crm.deal.amount.toLocaleString()} · ${crm.deal.status}`
                  : ` · ${crm.deal.status}`}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {crm.openFollowUps.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            <CalendarClock className="h-3 w-3" /> Open follow-ups
          </p>
          <ul className="space-y-1">
            {crm.openFollowUps.map((f) => (
              <li
                key={f.taskId}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink"
              >
                {f.title}
                {f.dueDate ? (
                  <span className="text-ink-3"> · due {f.dueDate.slice(0, 10)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canOrganize && rooms.length > 0 && (
        <div>
          {!showFollow ? (
            <button
              type="button"
              onClick={() => setShowFollow(true)}
              className="text-xs font-medium text-accent-d hover:underline"
            >
              Schedule follow-up…
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 px-3 py-3">
              <input
                className="w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink"
                value={followTitle}
                onChange={(e) => setFollowTitle(e.target.value)}
                placeholder="Follow-up title"
              />
              <select
                className="w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink"
                value={followRoomId}
                onChange={(e) => setFollowRoomId(e.target.value)}
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="w-full rounded-lg border border-border bg-canvas px-2 py-1.5 text-xs text-ink"
                value={followDue}
                onChange={(e) => setFollowDue(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !followDue || !followRoomId}
                  onClick={() =>
                    void run(async () => {
                      await inboxCreateFollowUp({
                        workspaceId,
                        threadId,
                        roomId: followRoomId,
                        title: followTitle || "Follow up",
                        dueDate: followDue,
                        clientActionId: newClientActionId(),
                      });
                      setShowFollow(false);
                    })
                  }
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowFollow(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-ink-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
