"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import { PageHeader } from "@/components/Page";
import { Card, Button } from "@/components/ui";
import { HumanAvatar } from "@/components/EmployeeAvatar";
import { assignableRoles, canManageMembers, roleLabel } from "@/lib/workspace/permissions";
import type { WorkspaceMemberRole } from "@/lib/types";
import { Mail, UserPlus, Users } from "lucide-react";

type MemberRow = {
  userId: string;
  role: string;
  name: string | null;
  email: string | null;
};

type InviteRow = { id: string; invited_email: string; role: string; status: string };

const ROLE_HELP: Record<WorkspaceMemberRole, string> = {
  admin: "Admin can manage billing and members",
  member: "Member can use rooms, AI employees, CRM, and the rest of the product",
};

export default function SettingsMembersPage() {
  const { state, actions, backend } = useStore();
  const workspaceId = state.workspace.id;
  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role ?? "member";
  const manage = canManageMembers(myRole) && backend === "supabase";

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceMemberRole>("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (backend !== "supabase") {
      setMembers(
        state.workspaceMembers.map((m) => ({
          userId: m.userId,
          role: m.role,
          name: m.name ?? null,
          email: m.email ?? null,
        })),
      );
      setLoading(false);
      return;
    }
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to load members.");
      setMembers(body.members ?? []);
      setInvites(body.invitations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [backend, workspaceId, state.workspaceMembers]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (userId: string, role: string) => {
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ targetUserId: userId, role }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Update failed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const removeMember = async (userId: string) => {
    if (!confirm("Remove this member from the workspace?")) return;
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/workspaces/${workspaceId}/members?userId=${userId}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Remove failed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    }
  };

  const revokeInvite = async (invitationId: string) => {
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/workspaces/${workspaceId}/invitations?invitationId=${encodeURIComponent(invitationId)}`,
        { method: "DELETE", headers },
      );
      if (!res.ok) throw new Error((await res.json())?.error ?? "Revoke failed.");
      await actions.revokeWorkspaceInvitation(invitationId).catch(() => undefined);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed.");
    }
  };

  const sendInvite = async () => {
    setError(null);
    if (!inviteEmail.trim()) {
      setError("Enter an email address.");
      return;
    }
    setInviteBusy(true);
    try {
      if (backend === "supabase") {
        const headers = await authHeaders();
        const res = await fetch(`/api/workspaces/${workspaceId}/invitations`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? "Unable to create invite.");
      } else {
        await actions.inviteWorkspaceMember(inviteEmail, inviteRole);
      }
      setInviteEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create invite.");
    } finally {
      setInviteBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Invite teammates and manage their roles. Humans are unlimited on every plan."
        icon={<Users className="h-5 w-5" />}
      />

      {error && <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Workspace humans</h2>
          <span className="chip">{members.length} member{members.length === 1 ? "" : "s"}</span>
        </div>

        {loading ? (
          <p className="text-sm text-ink-3">Loading…</p>
        ) : (
          <div className="space-y-2">
            {members.map((member) => {
              const isSelf = member.userId === state.user?.id;
              return (
                <div
                  key={member.userId}
                  className="flex items-center gap-3 rounded-xl border border-border-2 bg-muted/40 px-3 py-2.5"
                >
                  <HumanAvatar name={member.name ?? member.email ?? "Member"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {member.name ?? "Workspace member"}
                    </div>
                    <div className="truncate text-xs text-ink-3">{member.email ?? member.userId}</div>
                  </div>
                  {manage && !isSelf ? (
                    <>
                      <select
                        className="input-field h-9 w-32 py-0 text-sm"
                        value={
                          assignableRoles().includes(member.role as WorkspaceMemberRole)
                            ? member.role
                            : "member"
                        }
                        onChange={(e) => changeRole(member.userId, e.target.value)}
                      >
                        {assignableRoles().map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="ghost" onClick={() => removeMember(member.userId)}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <span className="rounded-md bg-surface px-2 py-1 text-xs text-ink-2">
                      {roleLabel(member.role)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {manage ? (
          <div className="mt-5 rounded-2xl border border-border-2 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
              <UserPlus className="h-4 w-4 text-accent" /> Invite a teammate
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
              <input
                type="email"
                className="input-field"
                placeholder="teammate@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <select
                className="input-field"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceMemberRole)}
              >
                {assignableRoles().map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
              <Button onClick={sendInvite} disabled={inviteBusy}>
                <Mail className="h-4 w-4" /> {inviteBusy ? "Inviting…" : "Invite"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-ink-3">{ROLE_HELP[inviteRole]}</p>
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-muted/60 px-3 py-3 text-sm text-ink-3">
            Only workspace admins can invite people and change roles.
          </p>
        )}

        {invites.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">
              Pending invitations
            </h3>
            <div className="space-y-2">
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-3 rounded-xl border border-border-2 bg-muted/40 px-3 py-2.5"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{invite.invited_email}</div>
                    <div className="text-xs text-ink-3">Role: {roleLabel(invite.role)}</div>
                  </div>
                  {manage ? (
                    <Button size="sm" variant="ghost" onClick={() => void revokeInvite(invite.id)}>
                      Revoke
                    </Button>
                  ) : (
                    <span className="rounded-md bg-surface px-2 py-1 text-xs capitalize text-ink-2">
                      {invite.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
