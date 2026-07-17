"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/Brand";
import { Check, ChevronDown, Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  acceptInvitationByToken,
  declineInvitationByToken,
} from "@/lib/workspace/invitations-client";
import { roleLabel } from "@/lib/workspace/permissions";

export function WorkspaceSwitcher({
  onCreateWorkspace,
  variant = "header",
}: {
  onCreateWorkspace?: () => void;
  variant?: "header" | "rail";
}) {
  const { state, userWorkspaces, actions, backend } = useStore();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRail = variant === "rail";
  const current = userWorkspaces.find((w) => w.id === state.workspace.id);
  const myRoleLabel = roleLabel(current?.role);

  const pendingInvites = useMemo(
    () =>
      state.workspaceInvitations.filter(
        (invite) =>
          invite.status === "pending" &&
          invite.invitedEmail.toLowerCase() === (state.user?.email ?? "").toLowerCase() &&
          invite.workspaceId !== state.workspace.id,
      ),
    [state.user?.email, state.workspace.id, state.workspaceInvitations],
  );

  const acceptInvite = async (token: string) => {
    setError(null);
    setBusyToken(token);
    try {
      const result = await acceptInvitationByToken(token);
      setOpen(false);
      await actions.switchWorkspace(result.workspaceId);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to accept invite.");
    } finally {
      setBusyToken(null);
    }
  };

  const declineInvite = async (token: string, id: string) => {
    setError(null);
    setBusyToken(token);
    try {
      await declineInvitationByToken(token);
      if (id) await actions.declineWorkspaceInvitation(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to decline invite.");
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
          "flex w-full items-center gap-2.5 rounded-[13px] border text-left transition-colors",
          isRail
            ? "border-[var(--rail-border)] bg-[var(--rail-fill)] px-2.5 py-2 hover:bg-[var(--rail-hover)]"
            : "h-9 border-border bg-surface px-3 text-sm hover:border-accent/40",
        )}
      >
        {isRail ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-accent">
            <BrandMark size={22} />
          </div>
        ) : (
          <span className="h-2 w-2 rounded-full bg-green" />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate font-semibold",
              isRail ? "text-[13.5px] text-[var(--rail-ink)]" : "text-ink",
            )}
          >
            {state.workspace.name || "Workspace"}
          </div>
          {isRail ? (
            <div className="truncate text-[11px] text-[var(--rail-ink-3)]">
              {[state.workspace.planDisplayName ?? state.workspace.planSlug ?? state.workspace.plan, myRoleLabel]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : (
            <div className="truncate text-[11px] text-ink-3">
              {state.workspace.planDisplayName ?? state.workspace.planSlug ?? state.workspace.plan}
            </div>
          )}
        </div>
        {pendingInvites.length > 0 ? (
          <span className="shrink-0 rounded-full bg-amber-soft px-1.5 text-[10px] font-medium text-amber">
            {pendingInvites.length}
          </span>
        ) : null}
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0", isRail ? "text-[var(--rail-ink-2)]" : "text-ink-3")}
        />
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className={cn(
                "absolute z-40 overflow-hidden rounded-xl border border-border bg-surface shadow-lift",
                isRail
                  ? "left-0 right-0 top-full mt-1 w-auto min-w-[12rem]"
                  : "left-0 top-11 w-72",
              )}
            >
              <div className="border-b border-border-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                Workspaces
              </div>
              <div className="max-h-64 overflow-y-auto p-1.5">
                {(backend === "supabase"
                  ? userWorkspaces
                  : [
                      {
                        id: state.workspace.id,
                        name: state.workspace.name,
                        role: current?.role ?? "admin",
                        workspaceMode: state.workspace.workspaceMode,
                        onboardingComplete: state.onboardingComplete,
                      },
                    ]
                ).map(
                  (ws) => {
                    const active = ws.id === state.workspace.id;
                    const incomplete = backend === "supabase" && !ws.onboardingComplete;
                    return (
                      <div
                        key={ws.id}
                        className={cn(
                          "flex w-full items-center gap-1 rounded-lg px-1 py-0.5",
                          active ? "bg-accent-soft" : "hover:bg-muted",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            if (!active && backend === "supabase") void actions.switchWorkspace(ws.id);
                          }}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-2 text-left text-sm",
                            active ? "text-accent-d" : "text-ink",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{ws.name}</div>
                            <div className="text-xs text-ink-3">
                              {incomplete ? "Setup incomplete" : roleLabel(ws.role)}
                              {ENABLE_DEMO_MODE && ws.workspaceMode === "demo" ? " · demo" : ""}
                            </div>
                          </div>
                          {active ? <Check className="h-4 w-4 shrink-0 text-accent" /> : null}
                        </button>
                        {incomplete ? (
                          <button
                            type="button"
                            disabled={discardingId === ws.id}
                            title="Discard unfinished workspace"
                            onClick={() => {
                              const ok = window.confirm(
                                `Discard “${ws.name}”? This unfinished workspace will be permanently deleted.`,
                              );
                              if (!ok) return;
                              setDiscardingId(ws.id);
                              setError(null);
                              void (async () => {
                                try {
                                  await actions.cancelIncompleteWorkspace(ws.id);
                                  setOpen(false);
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : "Could not discard workspace.",
                                  );
                                } finally {
                                  setDiscardingId(null);
                                }
                              })();
                            }}
                            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                          >
                            {discardingId === ws.id ? "…" : "Discard"}
                          </button>
                        ) : null}
                      </div>
                    );
                  },
                )}

                {pendingInvites.length > 0 ? (
                  <>
                    <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                      Pending invitations
                    </div>
                    {pendingInvites.map((invite) => (
                      <div key={invite.id} className="rounded-lg px-2.5 py-2">
                        <div className="truncate text-sm font-medium text-ink">
                          {invite.workspaceName ?? "Workspace"}
                        </div>
                        <div className="text-xs text-ink-3">as {roleLabel(invite.role)}</div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={busyToken === invite.token}
                            onClick={() => void acceptInvite(invite.token)}
                            className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={busyToken === invite.token}
                            onClick={() => void declineInvite(invite.token, invite.id)}
                            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-ink-2 disabled:opacity-60"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>

              {error ? (
                <div className="border-t border-border-2 px-3 py-2 text-xs text-danger">{error}</div>
              ) : null}

              {onCreateWorkspace ? (
                <div className="border-t border-border-2 p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onCreateWorkspace();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-2 hover:bg-muted"
                  >
                    <Plus className="h-4 w-4" /> Create workspace
                  </button>
                </div>
              ) : null}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
