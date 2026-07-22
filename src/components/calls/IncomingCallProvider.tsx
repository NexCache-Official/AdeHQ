"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Phone, PhoneOff, Smartphone } from "lucide-react";
import { authHeaders } from "@/lib/api/auth-client";
import { supabase } from "@/lib/supabase/client";
import { useStore } from "@/lib/demo-store";
import { Button, Modal } from "@/components/ui";
import type { CallSessionSummary } from "@/lib/calls/types";

type IncomingInvitation = {
  id: string;
  call_id: string;
  inviter_user_id: string;
  status: string;
  expires_at: string;
};

type CallNotificationsContextValue = {
  notificationPermission: NotificationPermission | "unsupported";
  health: {
    configured: boolean;
    enabledDevices: number;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  } | null;
  isIos: boolean;
  isInstalled: boolean;
  enableNotifications: () => Promise<void>;
  disableNotifications: () => Promise<void>;
  testNotifications: () => Promise<void>;
};

const CallNotificationsContext = createContext<CallNotificationsContextValue | null>(null);

export function useCallNotifications() {
  return useContext(CallNotificationsContext);
}

function deviceId() {
  const key = "adehq.call.device-id.v1";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export function IncomingCallProvider({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const router = useRouter();
  const [incoming, setIncoming] = useState<IncomingInvitation | null>(null);
  const [call, setCall] = useState<CallSessionSummary | null>(null);
  const [responding, setResponding] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [health, setHealth] = useState<CallNotificationsContextValue["health"]>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const workspaceId = state.workspace.id;
  const userId = state.user?.id;
  const isIos =
    typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

  const refreshHealth = useCallback(async () => {
    if (!workspaceId || !userId) return;
    const response = await fetch("/api/calls/push-subscriptions", {
      headers: await authHeaders(workspaceId),
      cache: "no-store",
    });
    if (!response.ok) return;
    setHealth(
      (await response.json()) as NonNullable<CallNotificationsContextValue["health"]>,
    );
  }, [userId, workspaceId]);

  const refresh = useCallback(async () => {
    if (!workspaceId || !userId) return;
    try {
      const response = await fetch("/api/calls/invitations", {
        headers: await authHeaders(workspaceId),
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { invitations?: IncomingInvitation[] };
      const next = body.invitations?.[0] ?? null;
      setIncoming(next);
      if (next) {
        const callResponse = await fetch(`/api/calls/${encodeURIComponent(next.call_id)}`, {
          headers: await authHeaders(workspaceId),
          cache: "no-store",
        });
        if (callResponse.ok) setCall((await callResponse.json()) as CallSessionSummary);
      } else {
        setCall(null);
      }
    } catch {
      // Polling is a best-effort fallback for incoming web ringing.
    }
  }, [userId, workspaceId]);

  useEffect(() => {
    setNotificationPermission(
      typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    );
    setIsInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    );
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  useEffect(() => {
    if (!workspaceId || !userId) return;
    void refresh();
    const interval = window.setInterval(refresh, 4_000);
    const channel = supabase
      .channel(`call-invitations:${workspaceId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_invitations",
          filter: `invitee_user_id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId, workspaceId]);

  const enableNotifications = useCallback(async () => {
    if (
      typeof Notification === "undefined" ||
      !("serviceWorker" in navigator) ||
      !workspaceId
    ) {
      setNotificationPermission("unsupported");
      throw new Error("Call notifications are not supported in this browser.");
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== "granted") return;
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) throw new Error("Call notifications are not configured.");
    const registration = await navigator.serviceWorker.register("/call-sw.js");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    const json = subscription.toJSON();
    const response = await fetch("/api/calls/push-subscriptions", {
      method: "POST",
      headers: await authHeaders(workspaceId),
      body: JSON.stringify({
        deviceId: deviceId(),
        endpoint: json.endpoint,
        keys: json.keys,
        userAgent: navigator.userAgent,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "Could not enable call notifications.");
    }
    await refreshHealth();
  }, [refreshHealth, workspaceId]);

  const testNotifications = useCallback(async () => {
    if (!workspaceId) return;
    const response = await fetch("/api/calls/push-subscriptions", {
      method: "PATCH",
      headers: await authHeaders(workspaceId),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error || "Could not send a test notification.");
    await refreshHealth();
  }, [refreshHealth, workspaceId]);

  const disableNotifications = useCallback(async () => {
    if (!workspaceId || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration("/call-sw.js");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      const response = await fetch(
        `/api/calls/push-subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`,
        {
          method: "DELETE",
          headers: await authHeaders(workspaceId),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Could not disable call notifications.");
      }
      await subscription.unsubscribe();
    }
    await refreshHealth();
  }, [refreshHealth, workspaceId]);

  const respond = useCallback(
    async (action: "accept" | "decline") => {
      if (!incoming || !workspaceId) return;
      setResponding(true);
      try {
        const response = await fetch("/api/calls/invitations", {
          method: "POST",
          headers: await authHeaders(workspaceId),
          body: JSON.stringify({
            invitationId: incoming.id,
            action,
            deviceId: deviceId(),
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          won?: boolean;
          status?: string;
        };
        if (!response.ok) throw new Error(body.error || "Could not answer call.");
        if (action === "accept" && body.won) {
          const callId = incoming.call_id;
          setIncoming(null);
          router.push(`/calls?call=${encodeURIComponent(callId)}`);
        } else {
          setIncoming(null);
          setCall(null);
        }
      } finally {
        setResponding(false);
      }
    },
    [incoming, router, workspaceId],
  );

  return (
    <CallNotificationsContext.Provider
      value={{
        notificationPermission,
        health,
        isIos,
        isInstalled,
        enableNotifications,
        disableNotifications,
        testNotifications,
      }}
    >
      {children}
      <Modal open={Boolean(incoming)} onClose={() => undefined} size="sm">
        <div className="px-6 py-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Phone className="h-6 w-6 animate-pulse" />
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-ink-3">
            Incoming call
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">{call?.title ?? "AdeHQ call"}</h2>
          <p className="mt-2 text-sm text-ink-3">
            Web ringing is best effort. Keep AdeHQ installed for more reliable notifications.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Button variant="danger" onClick={() => void respond("decline")} disabled={responding}>
              <PhoneOff className="h-4 w-4" /> Decline
            </Button>
            <Button onClick={() => void respond("accept")} disabled={responding}>
              <Phone className="h-4 w-4" /> Answer
            </Button>
          </div>
          {notificationPermission !== "granted" && notificationPermission !== "unsupported" ? (
            <button
              type="button"
              onClick={() => void enableNotifications()}
              className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
            >
              <Bell className="h-3.5 w-3.5" /> Enable background ringing
            </button>
          ) : null}
          {isIos && !isInstalled ? (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
              <Smartphone className="h-3.5 w-3.5" /> On iOS, add AdeHQ to your Home Screen.
            </p>
          ) : null}
        </div>
      </Modal>
    </CallNotificationsContext.Provider>
  );
}
