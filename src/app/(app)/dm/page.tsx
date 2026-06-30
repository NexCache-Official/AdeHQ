"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "@/components/AppShell";
import { PageContainer } from "@/components/Page";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import { EmployeeStatusBadge } from "@/components/EmployeeStatusBadge";
import { findDmRoomForEmployee, getDirectMessages } from "@/lib/rooms";
import { partitionWorkforce, isMayaEmployee, effectiveEmployeeStatus } from "@/lib/maya-employee";
import { MAYA_EMPLOYEE_NAME, MAYA_EMPLOYEE_TITLE, MAYA_WORKFORCE_BADGE } from "@/lib/hiring/maya";
import { UserPlus } from "lucide-react";

export default function DirectMessagesPage() {
  const { state, actions } = useStore();
  const ui = useShellUI();
  const router = useRouter();
  const { maya, hired } = partitionWorkforce(state.employees);
  const dmEmployees = [...maya, ...hired];

  const openEmployeeDm = (employeeId: string) => {
    const dm = actions.openOrCreateDM(employeeId);
    router.push(`/rooms/${dm.id}`);
  };

  return (
    <PageContainer wide>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Direct messages</h1>
          <p className="mt-1 text-sm text-ink-2">
            Private 1:1 conversations with each AI employee on your team.
          </p>
        </div>
        <button
          type="button"
          onClick={ui.openHire}
          className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_4px_14px_-6px_rgba(232,93,44,0.5)] transition-all hover:brightness-105"
        >
          <UserPlus className="h-4 w-4" strokeWidth={2} />
          Hire AI Employee
        </button>
      </div>

      {dmEmployees.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <p className="text-sm text-ink-3">No AI employees yet.</p>
          <button
            type="button"
            onClick={ui.openHire}
            className="mt-3 text-sm font-semibold text-accent-d hover:underline"
          >
            Hire your first teammate
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {dmEmployees.map((employee) => {
            const dm = findDmRoomForEmployee(state.rooms, employee.id);
            const isMaya = isMayaEmployee(employee);
            const latest =
              dm?.messages.filter((m) => m.senderType !== "system").at(-1)?.content?.slice(0, 56) ??
              "Start a conversation";

            return (
              <button
                key={employee.id}
                type="button"
                onClick={() => openEmployeeDm(employee.id)}
                className="lift rounded-[18px] border border-border bg-surface p-4 text-left"
              >
                <div className="flex items-start gap-3">
                  <EmployeeAvatar employee={employee} size="md" className="!h-[42px] !w-[42px] !rounded-[13px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink">{employee.name}</span>
                      {isMaya ? (
                        <span className="rounded-[5px] bg-muted px-[5px] py-0.5 text-[9px] font-bold text-ink-2">
                          {MAYA_WORKFORCE_BADGE}
                        </span>
                      ) : (
                        <span className="rounded-[5px] bg-accent-soft px-[5px] py-0.5 text-[9px] font-bold text-accent">
                          AI
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-2">{isMaya ? MAYA_EMPLOYEE_TITLE : employee.role}</p>
                    <div className="mt-2">
                      <EmployeeStatusBadge
                        status={effectiveEmployeeStatus(employee)}
                        compact
                      />
                    </div>
                  </div>
                  {dm && dm.unread > 0 && (
                    <span className="shrink-0 rounded-full bg-accent px-1.5 font-mono text-[10px] font-semibold text-white">
                      {dm.unread}
                    </span>
                  )}
                </div>
                <p className="mt-3 line-clamp-2 text-[11.5px] leading-relaxed text-ink-3">{latest}</p>
                <div className="mt-3 flex gap-2">
                  <span className="flex-1 rounded-[9px] bg-accent py-2 text-center text-xs font-semibold text-white">
                    Open chat
                  </span>
                  <Link
                    href={`/workforce/${employee.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 rounded-[9px] border border-border py-2 text-center text-xs font-medium text-ink-2 transition-colors hover:bg-muted"
                  >
                    Profile
                  </Link>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {getDirectMessages(state.rooms).length > 0 && (
        <p className="mt-6 text-center text-xs text-ink-3">
          {getDirectMessages(state.rooms).length} active conversation{getDirectMessages(state.rooms).length === 1 ? "" : "s"} · {MAYA_EMPLOYEE_NAME} is always available
        </p>
      )}
    </PageContainer>
  );
}
