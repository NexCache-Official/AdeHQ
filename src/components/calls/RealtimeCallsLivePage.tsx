"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  Bell,
  Bot,
  Camera,
  History,
  Phone,
  PhoneCall,
  Radio,
  UserRound,
  Users,
} from "lucide-react";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { EmptyState, LoadingState } from "@/components/States";
import { useStore } from "@/lib/demo-store";
import { isMayaEmployee } from "@/lib/maya-employee";
import { isDirectMessage } from "@/lib/rooms";
import { authHeaders } from "@/lib/api/auth-client";
import { LIVE_BRAIN_CALLS_ENABLED } from "@/lib/config/features";
import type { AIEmployee, ProjectRoom } from "@/lib/types";
import type { CallSessionSummary, HumanCallEntitlements } from "@/lib/calls/types";
import { cn } from "@/lib/utils";
import { RealtimeBrainCallRoom } from "./RealtimeBrainCallRoom";
import { HumanCallRoom } from "./HumanCallRoom";
import { useCallNotifications } from "./IncomingCallProvider";

type ActiveCall =
  | { type: "ai"; room: ProjectRoom; employee: AIEmployee; premium: boolean }
  | { type: "human"; call: CallSessionSummary };

type CallMetrics = {
  totalCalls: number;
  connectionSuccessRate: number | null;
  callDropRate: number | null;
  reconnectSuccessRate: number | null;
  averageTimeToAcceptMs: number | null;
  averageTimeToFirstAudioMs: number | null;
};

function RealtimeCallsInner() {
  const { state, actions } = useStore();
  const params = useSearchParams();
  const notifications = useCallNotifications();
  const [setupOpen, setSetupOpen] = useState(false);
  const [huddleOpen, setHuddleOpen] = useState(false);
  const [huddleRoomId, setHuddleRoomId] = useState("");
  const [huddleInvitees, setHuddleInvitees] = useState<string[]>([]);
  const [huddleVideo, setHuddleVideo] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [premium, setPremium] = useState(false);
  const [premiumVoiceAllowed, setPremiumVoiceAllowed] = useState(false);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [history, setHistory] = useState<CallSessionSummary[]>([]);
  const [startingHumanId, setStartingHumanId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<CallMetrics | null>(null);
  const [callEntitlements, setCallEntitlements] = useState<HumanCallEntitlements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoStartedHumanRoomRef = useRef<string | null>(null);

  const aiRooms = state.rooms.filter((room) => {
    if (!LIVE_BRAIN_CALLS_ENABLED) return false;
    if (!isDirectMessage(room) || !room.dmEmployeeId) return false;
    if ((room.status ?? "active") === "archived") return false;
    const employee = state.employees.find((candidate) => candidate.id === room.dmEmployeeId);
    return Boolean(employee && !isMayaEmployee(employee));
  });
  const humanRooms = state.rooms.filter(
    (room) =>
      isDirectMessage(room) &&
      !room.dmEmployeeId &&
      Boolean(room.dmOwnerUserId && room.dmPeerUserId) &&
      (room.status ?? "active") !== "archived",
  );
  const huddleRooms = state.rooms.filter(
    (room) => !isDirectMessage(room) && (room.status ?? "active") !== "archived",
  );
  const selectedRoom =
    aiRooms.find((room) => room.id === selectedRoomId) ?? aiRooms[0] ?? null;
  const selectedEmployee = selectedRoom?.dmEmployeeId
    ? state.employees.find((employee) => employee.id === selectedRoom.dmEmployeeId) ?? null
    : null;

  async function refreshHistory() {
    if (!state.workspace.id) return;
    try {
      const response = await fetch("/api/calls", {
        headers: await authHeaders(state.workspace.id),
        cache: "no-store",
      });
      if (response.ok) {
        const body = (await response.json()) as {
          calls?: CallSessionSummary[];
          entitlements?: HumanCallEntitlements;
        };
        setHistory(body.calls ?? []);
        setCallEntitlements(body.entitlements ?? null);
      }
    } catch {
      // The AI call surface remains usable when human calls are not yet migrated.
    }
  }

  async function refreshMetrics() {
    if (!state.workspace.id) return;
    const response = await fetch("/api/calls/metrics", {
      headers: await authHeaders(state.workspace.id),
      cache: "no-store",
    });
    if (response.ok) setMetrics((await response.json()) as CallMetrics);
  }

  useEffect(() => {
    void refreshHistory();
    void refreshMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspace.id]);

  useEffect(() => {
    if (!state.workspace.id || !LIVE_BRAIN_CALLS_ENABLED) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/calls/live/entitlements", {
          headers: await authHeaders(state.workspace.id),
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          premiumVoiceEnabled?: boolean;
          enabled?: boolean;
        };
        if (cancelled) return;
        const allowed = Boolean(body.enabled && body.premiumVoiceEnabled);
        setPremiumVoiceAllowed(allowed);
        if (!allowed) setPremium(false);
      } catch {
        // Setup UI still works; Connect will surface entitlement errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.workspace.id]);

  const callableRoomIds = aiRooms.map((room) => room.id).join(",");
  useEffect(() => {
    const roomId = params.get("room");
    if (!roomId) return;
    const room = aiRooms.find((candidate) => candidate.id === roomId);
    if (!room) return;
    setSelectedRoomId(room.id);
    setSetupOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, callableRoomIds]);

  const humanRoomIds = humanRooms.map((room) => room.id).join(",");
  useEffect(() => {
    const roomId = params.get("humanRoom");
    if (!roomId || autoStartedHumanRoomRef.current === roomId) return;
    const room = humanRooms.find((candidate) => candidate.id === roomId);
    if (!room) return;
    autoStartedHumanRoomRef.current = roomId;
    void beginHuman(room);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, humanRoomIds]);

  useEffect(() => {
    const callId = params.get("call");
    if (!callId || !state.workspace.id || active?.type === "human") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(callId)}`, {
          headers: await authHeaders(state.workspace.id),
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as CallSessionSummary & {
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || "Call is no longer available.");
        if (!cancelled) setActive({ type: "human", call: body });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not open call.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.type, params, state.workspace.id]);

  if (active?.type === "ai") {
    return (
      <div className="h-full min-h-0">
        <RealtimeBrainCallRoom
          workspaceId={state.workspace.id}
          roomId={active.room.id}
          employee={active.employee}
          premiumVoice={active.premium}
          onEnd={() => {
            setActive(null);
            // Call turns persist to the DM while RoomChat is unmounted — refresh
            // so the transcript is visible without a full page reload.
            void actions.refreshWorkspace();
          }}
        />
      </div>
    );
  }
  if (active?.type === "human" && state.user) {
    return (
      <div className="h-full min-h-[560px]">
        <HumanCallRoom
          initialCall={active.call}
          userId={state.user.id}
          members={state.workspaceMembers}
          employees={state.employees}
          onEnd={() => {
            setActive(null);
            void refreshHistory();
          }}
        />
      </div>
    );
  }

  function beginAi() {
    if (!selectedRoom || !selectedEmployee) return;
    setActive({ type: "ai", room: selectedRoom, employee: selectedEmployee, premium });
    setSetupOpen(false);
  }

  async function beginHuman(room: ProjectRoom, video = false) {
    if (!state.user || !state.workspace.id) return;
    const peerUserId =
      room.dmOwnerUserId === state.user.id ? room.dmPeerUserId : room.dmOwnerUserId;
    if (!peerUserId) return;
    setStartingHumanId(room.id);
    setError(null);
    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: await authHeaders(state.workspace.id),
        body: JSON.stringify({
          roomId: room.id,
          peerUserId,
          idempotencyKey: `${state.user.id}:${room.id}:${crypto.randomUUID()}`,
          video,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as CallSessionSummary & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Could not start call.");
      setActive({ type: "human", call: body });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start call.");
    } finally {
      setStartingHumanId(null);
    }
  }

  async function beginHuddle() {
    if (!state.user || !huddleRoomId || !huddleInvitees.length) return;
    setStartingHumanId(huddleRoomId);
    setError(null);
    try {
      const response = await fetch("/api/calls/huddles", {
        method: "POST",
        headers: await authHeaders(state.workspace.id),
        body: JSON.stringify({
          roomId: huddleRoomId,
          inviteeUserIds: huddleInvitees,
          idempotencyKey: `${state.user.id}:${huddleRoomId}:${crypto.randomUUID()}`,
          video: huddleVideo,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as CallSessionSummary & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Could not start huddle.");
      setActive({ type: "human", call: body });
      setHuddleOpen(false);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start huddle.");
    } finally {
      setStartingHumanId(null);
    }
  }

  const peerName = (room: ProjectRoom) => {
    const peerId =
      room.dmOwnerUserId === state.user?.id ? room.dmPeerUserId : room.dmOwnerUserId;
    return state.workspaceMembers.find((member) => member.userId === peerId)?.name ?? room.name;
  };

  return (
    <PageContainer wide>
      <PageHeader
        title="Calls"
        subtitle="Talk with people and hired AI employees. Human media is included; AI work is metered separately."
        icon={<Phone className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            {notifications?.notificationPermission !== "granted" ? (
              <Button variant="outline" onClick={() => void notifications?.enableNotifications().catch((notificationError) => setError(notificationError.message))}>
                <Bell className="h-4 w-4" /> Enable ringing
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void notifications?.testNotifications().catch((notificationError) => setError(notificationError.message))}>
                <Radio className="h-4 w-4" /> Test ringing
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!huddleRooms.length || callEntitlements?.groupCallsEnabled === false}
              onClick={() => {
                setHuddleRoomId((current) => current || huddleRooms[0]?.id || "");
                setHuddleOpen(true);
              }}
            >
              <Users className="h-4 w-4" /> Start huddle
            </Button>
            <Button onClick={() => setSetupOpen(true)} disabled={!aiRooms.length}>
              <Bot className="h-4 w-4" /> Call an employee
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="mb-5 flex items-center justify-between border-y border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
          <button type="button" onClick={() => setError(null)} className="font-semibold">Dismiss</button>
        </div>
      ) : null}

      {notifications?.notificationPermission === "granted" ? (
        <p className="mb-5 text-xs text-ink-3">
          Background ringing:{" "}
          {notifications.health?.enabledDevices
            ? `${notifications.health.enabledDevices} device${notifications.health.enabledDevices === 1 ? "" : "s"} enabled`
            : "checking subscription"}
          {notifications.isIos && !notifications.isInstalled
            ? " · Add AdeHQ to your Home Screen on iOS."
            : ""}
        </p>
      ) : null}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <UserRound className="h-4 w-4 text-ink-3" />
          <h2 className="text-sm font-semibold text-ink">People</h2>
        </div>
        {humanRooms.length ? (
          <div className="divide-y divide-border border-y border-border">
            {humanRooms.map((room) => (
              <div key={room.id} className="flex items-center gap-2 px-2 py-2">
                <button
                  type="button"
                  onClick={() => void beginHuman(room)}
                  disabled={startingHumanId === room.id}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left transition-colors disabled:opacity-60"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-ink-2">
                    <UserRound className="h-5 w-5" />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{peerName(room)}</span>
                    <span className="block truncate text-xs text-ink-3">Private human call · no Work Hours</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-ink-3">
                    <PhoneCall className="h-4 w-4" /> {startingHumanId === room.id ? "Ringing…" : "Audio"}
                  </span>
                </button>
                {callEntitlements?.videoEnabled ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={startingHumanId === room.id}
                    onClick={() => void beginHuman(room, true)}
                  >
                    <Camera className="h-4 w-4" /> Video
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="border-y border-border py-6 text-sm text-ink-3">Open a direct message with a workspace member to call them.</p>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-2 flex items-center gap-2">
          <Bot className="h-4 w-4 text-ink-3" />
          <h2 className="text-sm font-semibold text-ink">AI employees</h2>
        </div>
        {aiRooms.length ? (
          <div className="divide-y divide-border border-y border-border">
            {aiRooms.map((room) => {
              const employee = state.employees.find((candidate) => candidate.id === room.dmEmployeeId);
              if (!employee) return null;
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => {
                    setSelectedRoomId(room.id);
                    setSetupOpen(true);
                  }}
                  className="flex w-full items-center gap-3 px-2 py-4 text-left transition-colors hover:bg-muted/60"
                >
                  <EmployeeAvatar employee={employee} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{employee.name}</span>
                    <span className="block truncate text-xs text-ink-3">{employee.role}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-ink-3"><PhoneCall className="h-4 w-4" /> Call</span>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Phone} title="No employee conversations yet" description="Open a private employee conversation before calling them." />
        )}
      </section>

      {history.length ? (
        <section className="mt-8">
          <div className="mb-2 flex items-center gap-2">
            <History className="h-4 w-4 text-ink-3" />
            <h2 className="text-sm font-semibold text-ink">Recent calls</h2>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {history.slice(0, 12).map((item) => (
              <button key={item.id} type="button" onClick={() => setActive({ type: "human", call: item })} className="flex w-full items-center gap-3 py-3 text-left">
                <Phone className="h-4 w-4 text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.title}</span>
                <span className={cn("text-xs capitalize", item.status === "active" ? "text-success" : "text-ink-3")}>{item.status}</span>
                <time className="text-xs text-ink-3">{new Date(item.createdAt).toLocaleDateString()}</time>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {metrics && metrics.totalCalls > 0 ? (
        <section className="mt-8">
          <div className="mb-2 flex items-center gap-2">
            <Activity className="h-4 w-4 text-ink-3" />
            <h2 className="text-sm font-semibold text-ink">Call reliability · 30 days</h2>
          </div>
          <div className="grid gap-px overflow-hidden border-y border-border bg-border sm:grid-cols-3">
            {[
              ["Connected", metrics.connectionSuccessRate],
              ["Recovered", metrics.reconnectSuccessRate],
              ["Dropped", metrics.callDropRate],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-canvas px-4 py-3">
                <p className="text-xs text-ink-3">{label}</p>
                <p className="mt-1 text-lg font-semibold text-ink">
                  {typeof value === "number" ? `${Math.round(value * 100)}%` : "—"}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} size="md">
        <ModalHeader
          title={selectedEmployee ? `Call ${selectedEmployee.name}` : "Call an employee"}
          subtitle="Same as calling a teammate — they answer with their usual Brain."
          onClose={() => setSetupOpen(false)}
          icon={<PhoneCall className="h-5 w-5" />}
        />
        <div className="space-y-5 p-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Employee</span>
            <select className="input-field" value={selectedRoom?.id ?? ""} onChange={(event) => setSelectedRoomId(event.target.value)}>
              {aiRooms.map((room) => {
                const employee = state.employees.find((candidate) => candidate.id === room.dmEmployeeId);
                return <option key={room.id} value={room.id}>{employee?.name ?? room.name}</option>;
              })}
            </select>
          </label>
          <div>
            <p className="text-xs font-medium text-ink-3">Voice</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["standard", "premium"] as const).map((voice) => {
                const isPremium = voice === "premium";
                const selected = premium === isPremium;
                const disabled = isPremium && !premiumVoiceAllowed;
                return (
                  <button
                    key={voice}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      setPremium(isPremium);
                    }}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      disabled && "cursor-not-allowed opacity-50",
                      selected ? "border-accent-500 bg-accent-500/10" : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="block text-sm font-medium capitalize text-ink">{voice}</span>
                    <span className="mt-1 block text-xs text-ink-3">
                      {voice === "standard"
                        ? "Efficient everyday speech"
                        : premiumVoiceAllowed
                          ? "Higher-quality voice for Pro plans and above"
                          : "Available on Pro and above"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={() => setSetupOpen(false)}>Cancel</Button>
          <Button onClick={beginAi} disabled={!selectedEmployee || !state.workspace.id}><PhoneCall className="h-4 w-4" /> Call</Button>
        </div>
      </Modal>

      <Modal open={huddleOpen} onClose={() => setHuddleOpen(false)} size="md">
        <ModalHeader
          title="Start a room huddle"
          subtitle="Invite workspace members who can access this room."
          onClose={() => setHuddleOpen(false)}
          icon={<Users className="h-5 w-5" />}
        />
        <div className="space-y-5 p-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Room</span>
            <select
              className="input-field"
              value={huddleRoomId}
              onChange={(event) => setHuddleRoomId(event.target.value)}
            >
              {huddleRooms.map((room) => (
                <option key={room.id} value={room.id}>{room.name}</option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="text-xs font-medium text-ink-3">Invite people</legend>
            <div className="mt-2 max-h-48 divide-y divide-border overflow-y-auto border-y border-border">
              {state.workspaceMembers
                .filter(
                  (member) =>
                    member.userId !== state.user?.id && (member.status ?? "active") === "active",
                )
                .map((member) => {
                  const selected = huddleInvitees.includes(member.userId);
                  return (
                    <label key={member.userId} className="flex items-center gap-3 py-3 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setHuddleInvitees((current) =>
                            selected
                              ? current.filter((id) => id !== member.userId)
                              : [...current, member.userId],
                          )
                        }
                      />
                      <span className="min-w-0 truncate">{member.name ?? member.email ?? "Member"}</span>
                    </label>
                  );
                })}
            </div>
          </fieldset>
          <label className="flex items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={huddleVideo}
              onChange={(event) => setHuddleVideo(event.target.checked)}
            />
            Start with video when the workspace plan permits it
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={() => setHuddleOpen(false)}>Cancel</Button>
          <Button
            disabled={!huddleRoomId || !huddleInvitees.length || Boolean(startingHumanId)}
            onClick={() => void beginHuddle()}
          >
            <PhoneCall className="h-4 w-4" /> Start huddle
          </Button>
        </div>
      </Modal>
    </PageContainer>
  );
}

export function RealtimeCallsLivePage() {
  return <Suspense fallback={<LoadingState />}><RealtimeCallsInner /></Suspense>;
}
