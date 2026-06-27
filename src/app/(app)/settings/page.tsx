"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { PageContainer, PageHeader } from "@/components/Page";
import { Card, Button, Toggle } from "@/components/ui";
import { HumanAvatar } from "@/components/EmployeeAvatar";
import { ProviderId, WorkspaceMemberRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Brain,
  Check,
  Mail,
  RotateCcw,
  Settings as SettingsIcon,
  Sparkles,
  UserPlus,
} from "lucide-react";

const PROVIDERS: { id: ProviderId; name: string; desc: string; accent: string }[] = [
  { id: "anthropic", name: "Anthropic Claude", desc: "Claude models for reasoning and writing.", accent: "#d97757" },
  { id: "openai", name: "OpenAI", desc: "GPT models for reasoning and writing.", accent: "#10a37f" },
  { id: "gemini", name: "Google Gemini", desc: "Multimodal models from Google.", accent: "#4285f4" },
  { id: "perplexity", name: "Perplexity", desc: "Answer engine for cited research.", accent: "#22d3ee" },
  { id: "mock", name: "Local / Mock Mode", desc: "Deterministic scripted responses. Default for the demo.", accent: "#f97316" },
];

export default function SettingsPage() {
  const { state, actions, backend } = useStore();
  const router = useRouter();
  const [name, setName] = useState(state.user?.name ?? "");
  const [email, setEmail] = useState(state.user?.email ?? "");
  const [workspace, setWorkspace] = useState(state.workspace.name);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceMemberRole>("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const currentMember = state.workspaceMembers.find((m) => m.userId === state.user?.id);
  const canInvite = backend === "supabase" && (currentMember?.role === "owner" || currentMember?.role === "admin");
  const isRealWorkspace = state.workspace.workspaceMode !== "demo";

  const [saved, setSaved] = useState(false);
  const saveProfile = () => {
    actions.updateProfile({ name, email, workspaceName: workspace });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const sendInvite = async () => {
    setInviteError(null);
    if (!inviteEmail.trim()) {
      setInviteError("Enter an email address.");
      return;
    }
    setInviteBusy(true);
    try {
      await actions.inviteWorkspaceMember(inviteEmail, inviteRole);
      setInviteEmail("");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to create invite.");
    } finally {
      setInviteBusy(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader title="Settings" subtitle="Manage your workspace, profile, people, and model providers." icon={<SettingsIcon className="h-5 w-5" />} />

      <div className="space-y-6">
        {/* Workspace + profile */}
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Workspace & profile</h2>
          <div className="flex items-center gap-4">
            <HumanAvatar name={name || "User"} size="xl" />
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-500">Name</span>
                <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-500">Email</span>
                <input className="input-field" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block space-y-1.5 sm:col-span-2">
                <span className="text-xs font-medium text-slate-500">Workspace name</span>
                <input className="input-field" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={saveProfile}>
              <Check className="h-4 w-4" /> {saved ? "Saved!" : "Save changes"}
            </Button>
          </div>
        </Card>

        {/* Humans + invites */}
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Workspace humans</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Invite teammates now. They can accept after signing up with the invited email.
              </p>
            </div>
            <span className="chip">
              {state.workspaceMembers.length} member{state.workspaceMembers.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="space-y-2">
            {state.workspaceMembers.map((member) => (
              <div key={member.userId} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <HumanAvatar name={member.name ?? member.email ?? "Member"} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{member.name ?? "Workspace member"}</div>
                  <div className="truncate text-xs text-slate-500">{member.email ?? member.userId}</div>
                </div>
                <span className="rounded-md bg-white px-2 py-1 text-xs capitalize text-slate-600">{member.role}</span>
              </div>
            ))}
          </div>

          {canInvite ? (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <UserPlus className="h-4 w-4 text-accent-600" /> Invite a teammate
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
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
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <Button onClick={sendInvite} disabled={inviteBusy}>
                  <Mail className="h-4 w-4" /> {inviteBusy ? "Inviting..." : "Invite"}
                </Button>
              </div>
              {inviteError && <p className="mt-2 text-sm text-rose-700">{inviteError}</p>}
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
              Only workspace owners and admins can invite people.
            </p>
          )}

          {state.workspaceInvitations.filter((invite) => invite.workspaceId === state.workspace.id).length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">Invitations</h3>
              <div className="space-y-2">
                {state.workspaceInvitations
                  .filter((invite) => invite.workspaceId === state.workspace.id)
                  .map((invite) => (
                    <div key={invite.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500/10 text-accent-700">
                        <Mail className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900">{invite.invitedEmail}</div>
                        <div className="text-xs text-slate-500">Role: {invite.role}</div>
                      </div>
                      <span className="rounded-md bg-white px-2 py-1 text-xs capitalize text-slate-600">{invite.status}</span>
                      {canInvite && invite.status === "pending" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => actions.revokeWorkspaceInvitation(invite.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </Card>

        {/* Demo mode */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Demo mode</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Run on deterministic mock responses. Turn off only when you&apos;ve wired a real model API route.
              </p>
            </div>
            <Toggle
              checked={state.settings.mode === "mock"}
              onChange={(v) => actions.updateSettings({ mode: v ? "mock" : "live" })}
            />
          </div>
        </Card>

        {/* Model providers */}
        <Card className="p-6">
          <div className="mb-1 flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent-600" />
            <h2 className="text-sm font-semibold text-slate-900">Model providers</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Model keys are server-only. Workspace BYOK is coming soon — for now set OPENAI_API_KEY in your deployment environment.
          </p>
          <div className="space-y-3">
            {PROVIDERS.map((p) => {
              const active = state.settings.activeProvider === p.id;
              return (
                <div key={p.id} className={cn("rounded-xl border p-4 transition-colors", active ? "border-accent-500/40 bg-accent-500/[0.05]" : "border-slate-200 bg-slate-50")}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-900" style={{ background: `${p.accent}33`, color: p.accent }}>
                      {p.id === "mock" ? <Sparkles className="h-4 w-4" /> : <Brain className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{p.name}</span>
                        {active && <span className="rounded-md bg-accent-500/20 px-1.5 py-0.5 text-[10px] font-medium text-accent-700">Active</span>}
                      </div>
                      <p className="text-xs text-slate-500">{p.desc}</p>
                    </div>
                    {!active && (
                      <Button size="sm" variant="secondary" onClick={() => actions.updateSettings({ activeProvider: p.id })}>
                        Use
                      </Button>
                    )}
                  </div>
                  {p.id !== "mock" && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="password"
                          className="input-field"
                          placeholder={
                            p.id === "openai"
                              ? "Set OPENAI_API_KEY on the server"
                              : "Server-side key support coming later"
                          }
                          value=""
                          disabled
                          readOnly
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700/90">
            Keep provider secrets out of the browser. The live OpenAI route reads OPENAI_API_KEY only on the server.
          </p>
        </Card>

        {backend === "supabase" && canInvite && isRealWorkspace && (
          <Card className="border-rose-500/20 p-6">
            <h2 className="text-sm font-semibold text-slate-900">Clear workspace data</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Remove rooms, AI employees, messages, tasks, memory, approvals, work logs, and calls from this workspace, then run onboarding again.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-4"
              onClick={() => {
                if (confirm("Clear this workspace and rerun onboarding? This cannot be undone.")) {
                  actions.resetDemoData();
                  router.push("/onboarding");
                }
              }}
            >
              <RotateCcw className="h-4 w-4" /> Clear workspace
            </Button>
          </Card>
        )}

        {backend === "demo" && (
          <Card className="border-rose-500/20 p-6">
            <h2 className="text-sm font-semibold text-slate-900">Reset demo data</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Restore the original demo workspace. This control only appears in demo mode.
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-4"
              onClick={() => {
                if (confirm("Reset all demo data? This cannot be undone.")) {
                  actions.resetDemoData();
                  router.push("/");
                }
              }}
            >
              <RotateCcw className="h-4 w-4" /> Reset demo data
            </Button>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
