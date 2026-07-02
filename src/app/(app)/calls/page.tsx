"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { getGroupRooms, isGroupRoom } from "@/lib/rooms";
import { PageContainer, PageHeader } from "@/components/Page";
import { CallRoom } from "@/components/CallRoom";
import { Button, Card, Modal, ModalHeader } from "@/components/ui";
import { EmployeeAvatar, HumanAvatar } from "@/components/EmployeeAvatar";
import { EmptyState, LoadingState } from "@/components/States";
import { Call, CallParticipant } from "@/lib/types";
import { cn, formatDate, uid, nowISO } from "@/lib/utils";
import { Check, ListChecks, Phone, PhoneCall, Users } from "lucide-react";

function CallsInner() {
  const { state, actions } = useStore();
  const searchParams = useSearchParams();
  const groupRooms = useMemo(() => getGroupRooms(state.rooms), [state.rooms]);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [roomId, setRoomId] = useState(groupRooms[0]?.id ?? "");
  const [selected, setSelected] = useState<string[]>([]);

  const roomParam = searchParams.get("room");

  useEffect(() => {
    if (roomParam && state.rooms.some((r) => r.id === roomParam && isGroupRoom(r))) {
      setRoomId(roomParam);
      setSetupOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomParam]);

  const room = state.rooms.find((r) => r.id === roomId);
  const roomEmployees = useMemo(
    () => (room ? room.aiEmployees.map((id) => state.employees.find((e) => e.id === id)).filter((e): e is NonNullable<typeof e> => !!e) : []),
    [room, state.employees],
  );

  useEffect(() => {
    setSelected(roomEmployees.slice(0, 3).map((e) => e.id));
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pastCalls = state.calls.filter((c) => c.status === "ended");

  const startCall = () => {
    if (!room) return;
    const participants: CallParticipant[] = [
      { id: state.user?.id ?? "user-shubham", type: "human", name: state.user?.name ?? "You", accent: "#f97316", speaking: false },
      ...roomEmployees
        .filter((e) => selected.includes(e.id))
        .map((e) => ({ id: e.id, type: "ai" as const, name: e.name, accent: e.accent, speaking: false })),
    ];
    const call: Call = {
      id: uid("call"),
      roomId: room.id,
      title: `${room.name} — Workforce Call`,
      status: "live",
      participants,
      transcript: [],
      actionItems: [],
      startedAt: nowISO(),
    };
    actions.startCall(call);
    selected.forEach((id) => actions.updateEmployee(id, { status: "on_call" }));
    setActiveCall(call);
    setSetupOpen(false);
  };

  if (activeCall) {
    return (
      <div className="h-[calc(100vh-4rem)] p-4 sm:p-6">
        <CallRoom call={activeCall} onEnd={() => setActiveCall(null)} />
      </div>
    );
  }

  return (
    <PageContainer wide>
      <PageHeader
        title="Calls"
        subtitle="Jump on a live call with your humans and AI employees. They speak, take notes, and generate action items."
        icon={<Phone className="h-5 w-5" />}
        actions={
          <Button onClick={() => setSetupOpen(true)}>
            <PhoneCall className="h-4 w-4" /> Start a call
          </Button>
        }
      />

      {/* Start a call hero */}
      <Card className="mb-8 flex flex-col items-center gap-4 overflow-hidden p-8 text-center sm:flex-row sm:text-left">
        <div className="relative">
          <div className="absolute inset-0 -z-10 animate-pulse rounded-full bg-accent-500/30 blur-2xl" />
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-glow-amber text-white shadow-glow">
            <PhoneCall className="h-7 w-7" />
          </div>
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-slate-900">Start a workforce call</h2>
          <p className="mt-1 max-w-lg text-sm text-slate-500">
            Pick a room, invite your AI employees, and watch them discuss the plan, generate a transcript, and produce action items you can turn into tasks.
          </p>
        </div>
        <Button onClick={() => setSetupOpen(true)}>
          <PhoneCall className="h-4 w-4" /> New call
        </Button>
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent calls</h2>
      {pastCalls.length === 0 ? (
        <EmptyState icon={Phone} title="No calls yet" description="Start your first workforce call to see it here." action={{ label: "Start a call", onClick: () => setSetupOpen(true) }} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {pastCalls.map((c) => {
            const cRoom = state.rooms.find((r) => r.id === c.roomId);
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{c.title}</h3>
                    <p className="text-xs text-slate-500">{cRoom?.name} · {formatDate(c.startedAt)}</p>
                  </div>
                  <span className="chip"><Users className="h-3 w-3" /> {c.participants.length}</span>
                </div>
                <div className="mt-3 flex -space-x-2">
                  {c.participants.map((p) =>
                    p.type === "human" ? (
                      <HumanAvatar key={p.id} name={p.name} size="sm" className="!h-8 !w-8 ring-2 ring-white" />
                    ) : (
                      <div key={p.id} className="h-8 w-8 rounded-2xl ring-2 ring-white" style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.accent}99)` }} />
                    ),
                  )}
                </div>
                {c.actionItems.length > 0 && (
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                      <ListChecks className="h-3.5 w-3.5" /> Action items
                    </div>
                    <ul className="space-y-1">
                      {c.actionItems.slice(0, 3).map((item) => (
                        <li key={item} className="flex items-start gap-1.5 text-xs text-slate-500">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-500" /> {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Setup modal */}
      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} size="md">
        <ModalHeader title="Start a workforce call" onClose={() => setSetupOpen(false)} icon={<PhoneCall className="h-5 w-5" />} />
        <div className="space-y-4 p-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-500">Room</span>
            <select className="input-field" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {groupRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-500">Invite employees ({selected.length})</span>
            {roomEmployees.length === 0 ? (
              <p className="text-sm text-slate-500">No AI employees in this room yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {roomEmployees.map((e) => {
                  const on = selected.includes(e.id);
                  return (
                    <button
                      key={e.id}
                      onClick={() => setSelected((p) => (on ? p.filter((x) => x !== e.id) : [...p, e.id]))}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors",
                        on ? "border-accent-500/40 bg-accent-500/[0.06]" : "border-slate-200 bg-slate-50 hover:bg-slate-50",
                      )}
                    >
                      <EmployeeAvatar employee={e} size="sm" showStatus={false} />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{e.name}</span>
                      {on && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-white"><Check className="h-3 w-3" /></span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <Button variant="ghost" onClick={() => setSetupOpen(false)}>Cancel</Button>
          <Button onClick={startCall} disabled={!room}>
            <PhoneCall className="h-4 w-4" /> Start call
          </Button>
        </div>
      </Modal>
    </PageContainer>
  );
}

export default function CallsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CallsInner />
    </Suspense>
  );
}
