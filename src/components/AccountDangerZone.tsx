"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { clearActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/active-workspace";
import { Button, Modal, ModalHeader } from "./ui";
import { Card } from "./ui";
import { AlertTriangle, KeyRound, Trash2, UserX } from "lucide-react";
import type { AccountDeletionContext } from "@/lib/server/account-lifecycle";

type PendingDelete =
  | { kind: "workspace" }
  | { kind: "account"; withOwnedWorkspaces: boolean };

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

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthError, setReauthError] = useState<string | null>(null);

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

  const closeReauthModal = () => {
    setPendingDelete(null);
    setReauthPassword("");
    setReauthError(null);
  };

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

  const deleteWorkspace = async (password: string) => {
    setError(null);
    setBusy("workspace");
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ confirmName: workspaceConfirm, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Workspace deletion failed.");
      setWorkspaceConfirm("");
      closeReauthModal();
      await handleWorkspaceDeleted(data.remainingWorkspaceIds ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workspace deletion failed.";
      setReauthError(message);
      throw err;
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async (withOwnedWorkspaces: boolean, password: string) => {
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
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Account deletion failed.");
      closeReauthModal();
      clearActiveWorkspaceId();
      await actions.logout();
      router.replace("/login");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Account deletion failed.";
      setReauthError(message);
      throw err;
    } finally {
      setBusy(null);
    }
  };

  const requestDeleteWorkspace = () => {
    setReauthError(null);
    setReauthPassword("");
    setPendingDelete({ kind: "workspace" });
  };

  const requestDeleteAccount = (withOwnedWorkspaces: boolean) => {
    setReauthError(null);
    setReauthPassword("");
    setPendingDelete({ kind: "account", withOwnedWorkspaces });
  };

  const confirmWithPassword = async () => {
    if (!pendingDelete || !reauthPassword.trim()) {
      setReauthError("Enter your password to continue.");
      return;
    }
    setReauthError(null);
    try {
      if (pendingDelete.kind === "workspace") {
        await deleteWorkspace(reauthPassword);
      } else {
        await deleteAccount(pendingDelete.withOwnedWorkspaces, reauthPassword);
      }
    } catch {
      // error shown in modal
    }
  };

  const ownsCurrentWorkspace = ctx?.ownedWorkspaces.some((w) => w.id === workspaceId) ?? false;
  const canDeleteAccountAlone = ctx?.canDeleteAccountAlone ?? false;

  const reauthTitle =
    pendingDelete?.kind === "workspace"
      ? "Confirm workspace deletion"
      : pendingDelete?.withOwnedWorkspaces
        ? "Confirm workspace & account deletion"
        : "Confirm account deletion";

  const reauthSubtitle =
    pendingDelete?.kind === "workspace"
      ? `Enter your password to permanently delete "${workspaceName}".`
      : pendingDelete?.withOwnedWorkspaces
        ? "Enter your password to delete your workspace(s) and account."
        : "Enter your password to permanently delete your account.";

  return (
    <>
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
                  messages, AI employees, inbox mail (and frees the workspace email address),
                  tasks, memory, approvals, work logs, and usage history. Your AdeHQ account stays
                  active; you&apos;ll set up a new workspace.
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
                  onClick={requestDeleteWorkspace}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete workspace permanently
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
                  Type <span className="font-mono text-slate-700">{state.user?.email}</span> to
                  confirm
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
                    Also delete my owned workspace{ctx.ownedWorkspaces.length > 1 ? "s" : ""} and
                    all their data ({ctx.ownedWorkspaces.map((w) => w.name).join(", ")})
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
                  onClick={() => requestDeleteAccount(deleteOwnedWithAccount)}
                >
                  <UserX className="h-4 w-4" />
                  {deleteOwnedWithAccount
                    ? "Delete workspace & account"
                    : "Delete account only"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Modal open={pendingDelete !== null} onClose={closeReauthModal} size="sm">
        <ModalHeader
          title={reauthTitle}
          subtitle={reauthSubtitle}
          onClose={closeReauthModal}
          icon={<KeyRound className="h-4 w-4 text-rose-600" />}
        />
        <div className="space-y-4 px-6 pb-6">
          <p className="text-sm text-slate-600">
            For your security, sign in again with your password before we delete anything.
          </p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Password</span>
            <input
              type="password"
              className="input-field"
              value={reauthPassword}
              onChange={(e) => setReauthPassword(e.target.value)}
              placeholder="Your account password"
              autoComplete="current-password"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmWithPassword();
              }}
            />
          </label>
          {reauthError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{reauthError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={closeReauthModal} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy !== null || !reauthPassword.trim()}
              onClick={() => void confirmWithPassword()}
            >
              {busy !== null ? "Deleting…" : "Confirm & delete"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
