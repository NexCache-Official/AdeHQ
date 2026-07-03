"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AIEmployee, ProjectRoom, WorkspaceMember } from "@/lib/types";
import { EmployeeAvatar, HumanAvatar } from "@/components/EmployeeAvatar";
import { EmployeeStatusBadge } from "@/components/EmployeeStatusBadge";
import { effectiveEmployeeStatus } from "@/lib/maya-employee";
import { cn } from "@/lib/utils";
import { MessageSquare, X } from "lucide-react";

export function ParticipantAvatarStack({
  humans,
  employees,
  max = 4,
  size = "xs",
  className,
  onClick,
}: {
  humans: Array<{ id: string; name: string }>;
  employees: AIEmployee[];
  max?: number;
  size?: "xs" | "sm";
  className?: string;
  onClick?: () => void;
}) {
  const items = useMemo(() => {
    const out: Array<{ id: string; kind: "human" | "ai"; name: string; employee?: AIEmployee }> = [];
    for (const h of humans) out.push({ id: h.id, kind: "human", name: h.name });
    for (const e of employees) out.push({ id: e.id, kind: "ai", name: e.name, employee: e });
    return out;
  }, [humans, employees]);

  const visible = items.slice(0, max);
  const overflow = items.length - visible.length;

  const inner = (
    <div className={cn("flex items-center", className)}>
      <div className="flex -space-x-1.5">
        {visible.map((item, index) => (
          <span
            key={item.id}
            className="relative inline-flex rounded-lg ring-2 ring-surface"
            style={{ zIndex: visible.length - index }}
          >
            {item.kind === "human" ? (
              <HumanAvatar name={item.name} size={size} />
            ) : item.employee ? (
              <EmployeeAvatar employee={item.employee} size={size} showStatus={false} />
            ) : null}
          </span>
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-1.5 text-[10px] font-medium text-ink-3">+{overflow}</span>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-lg p-0.5 transition-colors hover:bg-muted"
        aria-label="View room members"
      >
        {inner}
      </button>
    );
  }

  return inner;
}

type RoomMembersPopoverProps = {
  open: boolean;
  onClose: () => void;
  room: ProjectRoom;
  employees: AIEmployee[];
  workspaceMembers: WorkspaceMember[];
  currentUserId?: string;
};

export function RoomMembersPopover({
  open,
  onClose,
  room,
  employees,
  workspaceMembers,
  currentUserId,
}: RoomMembersPopoverProps) {
  const router = useRouter();

  const humans = useMemo(
    () =>
      room.humans.map((id) => {
        const member = workspaceMembers.find((m) => m.userId === id);
        return {
          id,
          name: member?.name ?? (id === currentUserId ? "You" : "Teammate"),
          email: member?.email,
          role: id === room.humans[0] ? "Owner" : "Member",
        };
      }),
    [room.humans, workspaceMembers, currentUserId],
  );

  const roomEmployees = room.aiEmployees
    .map((id) => employees.find((e) => e.id === id))
    .filter((e): e is AIEmployee => !!e);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-16 sm:justify-end sm:pt-20 sm:pr-8">
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Room members</h2>
            <p className="text-[11px] text-ink-3">{room.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-3 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[min(70vh,480px)] overflow-y-auto p-3">
          <section className="mb-4">
            <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wide text-ink-3">
              Humans
            </h3>
            {humans.length === 0 ? (
              <p className="px-1 text-xs text-ink-3">No human members yet.</p>
            ) : (
              <ul className="space-y-1">
                {humans.map((human) => (
                  <li
                    key={human.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-2.5 py-2"
                  >
                    <HumanAvatar name={human.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{human.name}</div>
                      <div className="text-[11px] text-ink-3">{human.role}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wide text-ink-3">
              AI employees
            </h3>
            {roomEmployees.length === 0 ? (
              <p className="px-1 text-xs text-ink-3">No AI employees in this room.</p>
            ) : (
              <ul className="space-y-1">
                {roomEmployees.map((employee) => (
                  <li
                    key={employee.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface px-2.5 py-2"
                  >
                    <EmployeeAvatar employee={employee} size="sm" showStatus={false} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink">{employee.name}</div>
                      <div className="text-[11px] text-ink-3">{employee.role}</div>
                      <div className="mt-1">
                        <EmployeeStatusBadge status={effectiveEmployeeStatus(employee)} />
                      </div>
                    </div>
                    {room.kind === "dm" ? null : (
                      <button
                        type="button"
                        onClick={() => router.push(`/dm?employee=${employee.id}`)}
                        className="rounded-lg p-1.5 text-ink-3 hover:bg-muted hover:text-accent"
                        title={`Message ${employee.name}`}
                      >
                        <MessageSquare className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export const OPEN_PEOPLE_TAB_EVENT = "adehq:open-people-tab";

export function requestOpenPeopleTab(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PEOPLE_TAB_EVENT));
}
