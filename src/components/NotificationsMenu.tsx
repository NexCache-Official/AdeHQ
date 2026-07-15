"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bell } from "lucide-react";
import { useStore } from "@/lib/demo-store";
import { cn } from "@/lib/utils";
import {
  acceptInvitationByToken,
  declineInvitationByToken,
} from "@/lib/workspace/invitations-client";
import { roleLabel } from "@/lib/workspace/permissions";

export function NotificationsMenu({ variant = "rail" }: { variant?: "rail" | "header" }) {
  const { state, actions, backend } = useStore();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingInvites = useMemo(
    () =>
      state.workspaceInvitations.filter(
        (invite) =>
          invite.status === "pending" &&
          invite.invitedEmail.toLowerCase() === (state.user?.email ?? "").toLowerCase(),
      ),
    [state.user?.email, state.workspaceInvitations],
  );

  if (backend !== "supabase") return null;

  const accept = async (token: string) => {
    setError(null);
    setBusyToken(token);
    try {
      const result = await acceptInvitationByToken(token);
      await actions.switchWorkspace(result.workspaceId);
      setOpen(false);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to accept.");
    } finally {
      setBusyToken(null);
    }
  };

  const decline = async (token: string, id: string) => {
    setError(null);
    setBusyToken(token);
    try {
      await declineInvitationByToken(token);
      if (id) await actions.declineWorkspaceInvitation(id);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to decline.");
    } finally {
      setBusyToken(null);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex items-center justify-center rounded-[11px] transition-colors",
          variant === "rail"
            ? "h-9 w-9 border border-[var(--rail-border)] bg-[var(--rail-fill)] text-[var(--rail-ink-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]"
            : "h-9 w-9 border border-border bg-surface text-ink-2 hover:text-ink",
        )}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" strokeWidth={1.9} />
        {pendingInvites.length > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 text-[10px] font-semibold text-white">
            {pendingInvites.length}
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute left-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-lift"
            >
              <div className="border-b border-border-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                Notifications
              </div>
              <div className="max-h-80 overflow-y-auto p-1.5">
                {pendingInvites.length === 0 ? (
                  <p className="px-2.5 py-4 text-sm text-ink-3">No pending workspace invites.</p>
                ) : (
                  pendingInvites.map((invite) => (
                    <div
                      key={invite.id}
                      className="rounded-lg px-2.5 py-2.5 hover:bg-muted"
                    >
                      <div className="text-sm font-medium text-ink">
                        Invited to {invite.workspaceName ?? "a workspace"}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-3">
                        as {roleLabel(invite.role)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyToken === invite.token}
                          onClick={() => void accept(invite.token)}
                          className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={busyToken === invite.token}
                          onClick={() => void decline(invite.token, invite.id)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-ink-2 disabled:opacity-60"
                        >
                          Decline
                        </button>
                        <Link
                          href={`/invite/${invite.token}`}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-accent"
                          onClick={() => setOpen(false)}
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {error ? (
                <div className="border-t border-border-2 px-3 py-2 text-xs text-danger">{error}</div>
              ) : null}
              <div className="border-t border-border-2 px-3 py-2">
                <Link
                  href="/settings/notifications"
                  className="text-xs font-medium text-ink-2 hover:text-ink"
                  onClick={() => setOpen(false)}
                >
                  Notification settings
                </Link>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
