"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { clearActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/active-workspace";
import { Card, Button } from "./ui";
import { AlertTriangle, Trash2, UserX } from "lucide-react";
import type { AccountDeletionContext } from "@/lib/server/account-lifecycle";

export function AccountDangerZone({
  workspaceId,
  workspaceName,
  isWorkspaceOwner,
}: {
  workspaceId: string;
  workspaceName: string;
  isWorkspaceOwner: boolean;
}) {
  const { state, actions } = useStore();
  const router = useRouter();
  const [ctx, setCtx] = useState<AccountDeletionContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"workspace" | "account" | "both" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [workspaceConfirm, setWorkspaceConfirm] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [deleteOwnedWithAccount, setDeleteOwnedWithAccount] = useState(false);

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/account", { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to load account status.");
      setCtx(data as AccountDeletionContext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load account status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const handleWorkspaceDeleted = async (remainingWorkspaceIds: string[]) => {
    if (remainingWorkspaceIds.length > 0) {
      const nextId = remainingWorkspaceIds[0];
      setActiveWorkspaceId(nextId);
      await actions.switchWorkspace(nextId);
      router.push("/rooms");
      return;
    }
    clearActiveWorkspaceId();
    router.push("/onboarding");
    window.location.reload();
  };

  const deleteWorkspace = async () => {
    setError(null);
    setBusy("workspace");
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ confirmName: workspaceConfirm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Workspace deletion failed.");
      setWorkspaceConfirm("");
      await handleWorkspaceDeleted(data.remainingWorkspaceIds ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workspace deletion failed.");
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async (withOwnedWorkspaces: boolean) => {
    setError(null);
    setBusy(withOwnedWorkspaces ? "both" : "account");
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers,
        body: JSON.stringify({
          confirmEmail: emailConfirm,
          deleteOwnedWorkspaces: withOwnedWorkspaces,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Account deletion failed.");
      clearActiveWorkspaceId();
      await actions.logout();
      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account deletion failed.");
    } finally {
      setBusy(null);
    }
  };

  const ownsCurrentWorkspace = ctx?.ownedWorkspaces.some((w) => w.id === workspaceId) ?? false;
  const canDeleteAccountAlone = ctx?.canDeleteAccountAlone ?? false;

  return (
    <Card className="border-rose-500/25 p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Account & data</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Permanently delete workspace data or your account. These actions cannot be undone.
          </p>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading account status…</p>}
      {error && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      {ctx && !loading && (
        <div className="space-y-5">
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            <p>
              <span className="font-medium text-slate-800">Signed in as</span> {ctx.email}
            </p>
            {ctx.ownedWorkspaces.length > 0 && (
              <p className="mt-1">
                You own {ctx.ownedWorkspaces.length} workspace
                {ctx.ownedWorkspaces.length === 1 ? "" : "s"}:{" "}
                {ctx.ownedWorkspaces.map((w) => w.name).join(", ")}
              </p>
            )}
            {ctx.memberWorkspaces.length > 0 && (
              <p className="mt-1">
                Member of {ctx.memberWorkspaces.length} other workspace
                {ctx.memberWorkspaces.length === 1 ? "" : "s"} (account can be deleted without
                removing those workspaces).
              </p>
            )}
          </div>

          {isWorkspaceOwner && ownsCurrentWorkspace && (
            <div className="rounded-2xl border border-rose-200/60 bg-rose-50/30 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Delete workspace</h3>
              <p className="mt-1 text-sm text-slate-600">
                Removes <span className="font-medium">{workspaceName}</span> and all data — rooms,
                messages, AI employees, tasks, memory, approvals, work logs, and usage history.
                Your AdeHQ account stays active; you&apos;ll set up a new workspace.
              </p>
              <label className="mt-3 block space-y-1.5">
                <span className="text-xs font-medium text-slate-500">
                  Type <span className="font-mono text-slate-700">{workspaceName}</span> to confirm
                </span>
                <input
                  className="input-field"
                  value={workspaceConfirm}
                  onChange={(e) => setWorkspaceConfirm(e.target.value)}
                  placeholder={workspaceName}
                />
              </label>
              <Button
                variant="danger"
                size="sm"
                className="mt-3"
                disabled={busy !== null || workspaceConfirm.trim() !== workspaceName.trim()}
                onClick={() => void deleteWorkspace()}
              >
                <Trash2 className="h-4 w-4" />
                {busy === "workspace" ? "Deleting workspace…" : "Delete workspace permanently"}
              </Button>
            </div>
          )}

          <div className="rounded-2xl border border-rose-200/60 bg-rose-50/30 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Delete account</h3>
            {!canDeleteAccountAlone ? (
              <p className="mt-1 text-sm text-slate-600">
                You cannot delete your account while you own a workspace. Delete the workspace
                above first, or delete your workspace and account together below.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-600">
                Removes your profile and signs you out. Workspace data you don&apos;t own is
                unaffected.
              </p>
            )}

            <label className="mt-3 block space-y-1.5">
              <span className="text-xs font-medium text-slate-500">
                Type <span className="font-mono text-slate-700">{state.user?.email}</span> to confirm
              </span>
              <input
                className="input-field"
                type="email"
                value={emailConfirm}
                onChange={(e) => setEmailConfirm(e.target.value)}
                placeholder={state.user?.email ?? "you@company.com"}
              />
            </label>

            {ctx.requiresWorkspaceDeletionFirst && isWorkspaceOwner && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={deleteOwnedWithAccount}
                  onChange={(e) => setDeleteOwnedWithAccount(e.target.checked)}
                />
                <span>
                  Also delete my owned workspace{ctx.ownedWorkspaces.length > 1 ? "s" : ""} and all
                  their data ({ctx.ownedWorkspaces.map((w) => w.name).join(", ")})
                </span>
              </label>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={
                  busy !== null ||
                  emailConfirm.trim().toLowerCase() !== (state.user?.email ?? "").toLowerCase() ||
                  (!canDeleteAccountAlone && !deleteOwnedWithAccount)
                }
                onClick={() => void deleteAccount(deleteOwnedWithAccount)}
              >
                <UserX className="h-4 w-4" />
                {busy === "account" || busy === "both"
                  ? "Deleting account…"
                  : deleteOwnedWithAccount
                    ? "Delete workspace & account"
                    : "Delete account only"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
