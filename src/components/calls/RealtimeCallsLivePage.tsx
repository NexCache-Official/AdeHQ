"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Phone, PhoneCall } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/Page";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { Button, Modal, ModalHeader } from "@/components/ui";
import { EmptyState, LoadingState } from "@/components/States";
import { useStore } from "@/lib/demo-store";
import { isMayaEmployee } from "@/lib/maya-employee";
import { isDirectMessage } from "@/lib/rooms";
import type { AIEmployee, ProjectRoom } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RealtimeBrainCallRoom } from "./RealtimeBrainCallRoom";

type SelectedCall = { room: ProjectRoom; employee: AIEmployee; premium: boolean };

function RealtimeCallsInner() {
  const { state } = useStore();
  const params = useSearchParams();
  const [setupOpen, setSetupOpen] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [premium, setPremium] = useState(false);
  const [active, setActive] = useState<SelectedCall | null>(null);

  // Maya is the workspace guide — calls are only for hired AI employees.
  const dmRooms = state.rooms.filter((room) => {
    if (!isDirectMessage(room) || !room.dmEmployeeId) return false;
    if ((room.status ?? "active") === "archived") return false;
    const employee = state.employees.find(
      (candidate) => candidate.id === room.dmEmployeeId,
    );
    return Boolean(employee && !isMayaEmployee(employee));
  });
  const selectedRoom =
    dmRooms.find((room) => room.id === selectedRoomId) ?? dmRooms[0] ?? null;
  const selectedEmployee = selectedRoom?.dmEmployeeId
    ? state.employees.find((employee) => employee.id === selectedRoom.dmEmployeeId) ?? null
    : null;

  const callableRoomIds = dmRooms.map((room) => room.id).join(",");
  useEffect(() => {
    const roomId = params.get("room");
    if (!roomId) return;
    const room = dmRooms.find((candidate) => candidate.id === roomId);
    if (!room) return;
    setSelectedRoomId(room.id);
    setSetupOpen(true);
    // dmRooms is rebuilt each render; key off the stable callable id list instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, callableRoomIds]);

  if (active) {
    return (
      <div className="h-[calc(100vh-4rem)] min-h-[560px]">
        <RealtimeBrainCallRoom
          workspaceId={state.workspace.id}
          roomId={active.room.id}
          employee={active.employee}
          premiumVoice={active.premium}
          onEnd={() => setActive(null)}
        />
      </div>
    );
  }

  function begin() {
    if (!selectedRoom || !selectedEmployee) return;
    setActive({ room: selectedRoom, employee: selectedEmployee, premium });
    setSetupOpen(false);
  }

  return (
    <PageContainer wide>
      <PageHeader
        title="Calls"
        subtitle="Talk privately with the same AdeHQ employees, memory, permissions, and tools you use in chat."
        icon={<Phone className="h-5 w-5" />}
        actions={
          <Button onClick={() => setSetupOpen(true)} disabled={!dmRooms.length}>
            <PhoneCall className="h-4 w-4" /> Call an employee
          </Button>
        }
      />

      {dmRooms.length === 0 ? (
        <EmptyState
          icon={Phone}
          title="No employee conversations yet"
          description="Open a private conversation with an employee before starting a call."
        />
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {dmRooms.map((room) => {
            const employee = state.employees.find(
              (candidate) => candidate.id === room.dmEmployeeId,
            );
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
                  <span className="block truncate text-sm font-semibold text-ink">
                    {employee.name}
                  </span>
                  <span className="block truncate text-xs text-ink-3">{employee.role}</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs text-ink-3">
                  <PhoneCall className="h-4 w-4" /> Call
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} size="md">
        <ModalHeader
          title="Start a Brain Call"
          onClose={() => setSetupOpen(false)}
          icon={<PhoneCall className="h-5 w-5" />}
        />
        <div className="space-y-5 p-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-3">Employee</span>
            <select
              className="input-field"
              value={selectedRoom?.id ?? ""}
              onChange={(event) => setSelectedRoomId(event.target.value)}
            >
              {dmRooms.map((room) => {
                const employee = state.employees.find(
                  (candidate) => candidate.id === room.dmEmployeeId,
                );
                return (
                  <option key={room.id} value={room.id}>
                    {employee?.name ?? room.name}
                  </option>
                );
              })}
            </select>
          </label>
          <div>
            <p className="text-xs font-medium text-ink-3">Voice</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["standard", "premium"] as const).map((voice) => {
                const selected = premium === (voice === "premium");
                return (
                  <button
                    key={voice}
                    type="button"
                    onClick={() => setPremium(voice === "premium")}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      selected
                        ? "border-accent-500 bg-accent-500/10"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="block text-sm font-medium capitalize text-ink">
                      {voice}
                    </span>
                    <span className="mt-1 block text-xs text-ink-3">
                      {voice === "standard"
                        ? "Efficient everyday speech"
                        : "Used when your plan permits it"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-xs leading-relaxed text-ink-3">
            Standard calls show listening activity, then a final transcript after each
            natural pause. Word-by-word live captions are not claimed in this mode.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={() => setSetupOpen(false)}>
            Cancel
          </Button>
          <Button onClick={begin} disabled={!selectedEmployee || !state.workspace.id}>
            <PhoneCall className="h-4 w-4" /> Connect
          </Button>
        </div>
      </Modal>
    </PageContainer>
  );
}

export function RealtimeCallsLivePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RealtimeCallsInner />
    </Suspense>
  );
}
