"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mail, X } from "lucide-react";
import { useStore } from "@/lib/demo-store";
import { fetchMailbox } from "@/lib/inbox/client";

const DISMISS_KEY = "adehq.inboxClaimBannerDismissed";

/**
 * Home banner for admins when the workspace has not claimed an inbox address yet.
 */
export function UnclaimedInboxBanner() {
  const { state, backend } = useStore();
  const workspaceId = state.workspace.id;
  const role =
    state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role ?? "member";
  const isAdmin = role === "admin";

  const [show, setShow] = useState(false);

  useEffect(() => {
    // Demo mode has no signed-in Supabase session — skip mailbox probe.
    if (!workspaceId || !isAdmin || backend === "demo") {
      setShow(false);
      return;
    }
    let cancelled = false;
    const dismissed =
      typeof window !== "undefined"
        ? sessionStorage.getItem(`${DISMISS_KEY}:${workspaceId}`)
        : null;
    if (dismissed === "1") {
      setShow(false);
      return;
    }

    void fetchMailbox(workspaceId)
      .then((res) => {
        if (!cancelled) setShow(!res.claimed && res.canClaim);
      })
      .catch(() => {
        if (!cancelled) setShow(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, isAdmin]);

  if (!show) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Choose your workspace inbox address</p>
        <p className="mt-0.5 text-amber-900/80">
          No address is assigned until you claim one. Pick it under Settings → Inbox so your team
          can send and receive mail.
        </p>
        <Link
          href="/settings/inbox"
          className="mt-2 inline-flex text-sm font-semibold text-amber-900 underline-offset-2 hover:underline"
        >
          Set up Inbox →
        </Link>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        className="rounded-md p-1 text-amber-800/70 hover:bg-amber-100 hover:text-amber-950"
        onClick={() => {
          sessionStorage.setItem(`${DISMISS_KEY}:${workspaceId}`, "1");
          setShow(false);
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
