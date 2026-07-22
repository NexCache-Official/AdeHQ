"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authHeaders } from "@/lib/api/auth-client";
import { PageHeader } from "@/components/Page";
import { Card, Button, Toggle } from "@/components/ui";
import { useStore } from "@/lib/demo-store";
import {
  acceptInvitationByToken,
  declineInvitationByToken,
} from "@/lib/workspace/invitations-client";
import { roleLabel } from "@/lib/workspace/permissions";
import { Bell, Building2, ShieldCheck } from "lucide-react";
import { useCallNotifications } from "@/components/calls/IncomingCallProvider";

type Prefs = {
  product_updates: boolean;
  weekly_reports: boolean;
  activity_notifications: boolean;
};

const CATEGORIES: { key: keyof Prefs; title: string; description: string }[] = [
  { key: "product_updates", title: "Product updates", description: "New features, milestones, and welcome emails." },
  { key: "weekly_reports", title: "Weekly reports", description: "Workspace summaries, work-hours alerts, and intelligence reports." },
  { key: "activity_notifications", title: "Activity notifications", description: "Mentions, completed research/tasks, and approval requests." },
];

export default function NotificationsSettingsPage() {
  const { state, actions } = useStore();
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<keyof Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);
  const [callNotificationBusy, setCallNotificationBusy] = useState(false);
  const callNotifications = useCallNotifications();

  const pendingInvites = useMemo(
    () =>
      state.workspaceInvitations.filter(
        (invite) =>
          invite.status === "pending" &&
          invite.invitedEmail.toLowerCase() === (state.user?.email ?? "").toLowerCase(),
      ),
    [state.user?.email, state.workspaceInvitations],
  );

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/email/preferences", { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to load preferences.");
      setPrefs(body.preferences);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load preferences.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: keyof Prefs, value: boolean) => {
    if (!prefs) return;
    setError(null);
    setSavingKey(key);
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/email/preferences", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to save.");
      setPrefs(body.preferences);
    } catch (err) {
      setPrefs(previous);
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Workspace invites and email preferences. Account, security, and billing emails are always sent."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
          <Building2 className="h-4 w-4 text-accent" />
          Workspace invites
        </div>
        {pendingInvites.length === 0 ? (
          <p className="text-sm text-ink-3">No pending workspace invitations.</p>
        ) : (
          <div className="space-y-3">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border-2 bg-muted/40 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {invite.workspaceName ?? "Workspace"}
                  </div>
                  <div className="text-xs text-ink-3">Invited as {roleLabel(invite.role)}</div>
                </div>
                <Button
                  size="sm"
                  disabled={inviteBusy === invite.token}
                  onClick={() => {
                    void (async () => {
                      setInviteBusy(invite.token);
                      setError(null);
                      try {
                        const result = await acceptInvitationByToken(invite.token);
                        await actions.switchWorkspace(result.workspaceId);
                        router.push("/");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Unable to accept.");
                      } finally {
                        setInviteBusy(null);
                      }
                    })();
                  }}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={inviteBusy === invite.token}
                  onClick={() => {
                    void (async () => {
                      setInviteBusy(invite.token);
                      setError(null);
                      try {
                        await declineInvitationByToken(invite.token);
                        await actions.declineWorkspaceInvitation(invite.id);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Unable to decline.");
                      } finally {
                        setInviteBusy(null);
                      }
                    })();
                  }}
                >
                  Decline
                </Button>
                <Link
                  href={`/invite/${invite.token}`}
                  className="text-xs font-medium text-accent"
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-ink">Call ringing</h2>
      <Card className="mb-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-d">
              <Bell className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-medium text-ink">Background call notifications</div>
              <div className="text-xs text-ink-3">
                Best-effort web ringing
                {callNotifications?.isIos && !callNotifications.isInstalled
                  ? " · Add AdeHQ to your Home Screen on iOS."
                  : "."}
              </div>
              {callNotifications?.health?.lastFailureAt ? (
                <div className="mt-1 text-xs text-danger">
                  Last delivery failure:{" "}
                  {new Date(callNotifications.health.lastFailureAt).toLocaleString()}
                </div>
              ) : null}
            </div>
          </div>
          <Toggle
            checked={
              callNotifications?.notificationPermission === "granted" &&
              Boolean(callNotifications.health?.enabledDevices)
            }
            disabled={
              callNotificationBusy ||
              callNotifications?.notificationPermission === "unsupported"
            }
            onChange={(enabled) => {
              if (!callNotifications) return;
              setCallNotificationBusy(true);
              setError(null);
              void (enabled
                ? callNotifications.enableNotifications()
                : callNotifications.disableNotifications()
              )
                .catch((notificationError) =>
                  setError(
                    notificationError instanceof Error
                      ? notificationError.message
                      : "Could not update call notifications.",
                  ),
                )
                .finally(() => setCallNotificationBusy(false));
            }}
          />
        </div>
        {callNotifications?.notificationPermission === "granted" &&
        callNotifications.health?.enabledDevices ? (
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={callNotificationBusy}
              onClick={() => {
                setCallNotificationBusy(true);
                void callNotifications
                  .testNotifications()
                  .catch((notificationError) =>
                    setError(
                      notificationError instanceof Error
                        ? notificationError.message
                        : "Could not send a test notification.",
                    ),
                  )
                  .finally(() => setCallNotificationBusy(false));
              }}
            >
              Send test
            </Button>
          </div>
        ) : null}
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-ink">Email preferences</h2>
      <Card className="p-0">
        {loading || !prefs ? (
          <div className="p-6 text-sm text-ink-3">Loading preferences…</div>
        ) : (
          <div className="divide-y divide-border-2">
            {CATEGORIES.map((cat) => (
              <div key={cat.key} className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-d">
                    <Bell className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-ink">{cat.title}</div>
                    <div className="text-xs text-ink-3">{cat.description}</div>
                  </div>
                </div>
                <Toggle
                  checked={prefs[cat.key]}
                  disabled={savingKey === cat.key}
                  onChange={(v) => toggle(cat.key, v)}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-4 flex items-start gap-2 text-xs text-ink-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <span>
          Account, security, and billing emails (sign-in links, password changes, receipts) are
          always delivered and can&apos;t be turned off.
        </span>
      </div>
    </>
  );
}
