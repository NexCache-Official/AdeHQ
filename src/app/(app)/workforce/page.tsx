"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "@/components/AppShell";
import { useWorkspaceUsage } from "@/hooks/useWorkspaceUsage";
import { partitionWorkforce } from "@/lib/maya-employee";
import { MAYA_EMPLOYEE_NAME, MAYA_WORKFORCE_BADGE } from "@/lib/hiring/maya";
import { EmployeeCard } from "@/components/EmployeeCard";
import { HumanAvatar } from "@/components/EmployeeAvatar";
import { avatarAccentForId } from "@/lib/avatar-accent";
import { canManageAiEmployees, roleLabel } from "@/lib/workspace/permissions";
import { canAccessMaya } from "@/lib/workspace/access";
import { Bot, MessageSquare, UserPlus, Users } from "lucide-react";

export default function WorkforcePage() {
  const { state, actions } = useStore();
  const ui = useShellUI();
  const router = useRouter();
  const { data: usage } = useWorkspaceUsage(state.workspace.id);
  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role;
  const canHire = canManageAiEmployees(myRole);
  const showMaya = canAccessMaya(myRole);

  const openEmployeeDm = (employeeId: string) => {
    const dm = actions.openOrCreateDM(employeeId);
    router.push(`/rooms/${dm.id}`);
  };

  const openHumanDm = (peerUserId: string) => {
    const dm = actions.openOrCreateHumanDM(peerUserId);
    router.push(`/rooms/${dm.id}`);
  };

  const { maya, hired } = partitionWorkforce(state.employees);
  const visibleMaya = showMaya ? maya : [];
  const humans = useMemo(
    () =>
      state.workspaceMembers.filter(
        (m) => m.status !== "removed" && m.userId !== state.user?.id,
      ),
    [state.workspaceMembers, state.user?.id],
  );

  const recentWork = useMemo(
    () =>
      [...state.workLog]
        .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        .slice(0, 5),
    [state.workLog],
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="fade-up mx-auto max-w-[1180px] px-6 py-7 pb-16 sm:px-9">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Workforce</h1>
            <p className="mt-1 text-sm text-ink-2">
              {humans.length + 1} people · {hired.length} AI
              {visibleMaya.length > 0 ? ` · ${MAYA_EMPLOYEE_NAME}` : ""}
              {usage?.capacity
                ? usage.capacity.unlimited
                  ? " · Unlimited AI Work Hours"
                  : ` · ${(usage.totalWorkHours ?? usage.capacity.used ?? 0).toFixed(2)} of ${(usage.capacity.allowance ?? 0).toFixed(2)} AI Work Hours used`
                : ""}
            </p>
          </div>
          {canHire && (
            <button
              type="button"
              onClick={ui.openHire}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_-6px_rgba(47,111,237,0.5)] transition-all hover:brightness-105"
            >
              <UserPlus className="h-4 w-4" strokeWidth={2} />
              Hire AI Employee
            </button>
          )}
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[1.6fr_1fr]">
          <div className="space-y-8">
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-ink-3" strokeWidth={2} />
                <h2 className="text-base font-bold text-ink">People</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {state.workspaceMembers
                  .filter((m) => m.status !== "removed")
                  .map((member) => {
                    const isSelf = member.userId === state.user?.id;
                    const accent = avatarAccentForId(member.userId);
                    return (
                      <div
                        key={member.userId}
                        className="flex items-center gap-3 rounded-[16px] border border-border bg-surface p-3.5"
                      >
                        <HumanAvatar
                          name={member.name ?? member.email ?? "Member"}
                          size="md"
                          accent={accent.background}
                          userId={member.userId}
                          src={member.avatar}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-ink">
                            {member.name ?? "Workspace member"}
                            {isSelf ? " (you)" : ""}
                          </div>
                          <div className="truncate text-xs text-ink-2">
                            {roleLabel(member.role)}
                            {member.email ? ` · ${member.email}` : ""}
                          </div>
                        </div>
                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => openHumanDm(member.userId)}
                            className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-ink-2 hover:bg-muted"
                          >
                            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            </section>

            {visibleMaya.length > 0 && (
              <section>
                <h2 className="mb-3 text-base font-bold text-ink">{MAYA_WORKFORCE_BADGE}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {visibleMaya.map((employee) => (
                    <EmployeeCard
                      key={employee.id}
                      employee={employee}
                      badge={MAYA_WORKFORCE_BADGE}
                      onMessage={(emp) => openEmployeeDm(emp.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-3 text-base font-bold text-ink">AI employees</h2>
              {hired.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-ink-3">
                  <Bot className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  {canHire
                    ? "No AI employees yet. Hire your first teammate to get started."
                    : "No AI employees available in this workspace yet."}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {hired.map((e) => (
                    <EmployeeCard
                      key={e.id}
                      employee={e}
                      onMessage={(emp) => openEmployeeDm(emp.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          <div>
            {recentWork.length > 0 && (
              <section>
                <h2 className="mb-3 text-base font-bold text-ink">Recent work</h2>
                <div className="rounded-2xl border border-border bg-surface px-4 py-1">
                  {recentWork.map((w, i) => {
                    const emp = state.employees.find((e) => e.id === w.employeeId);
                    const room = state.rooms.find((r) => r.id === w.roomId);
                    return (
                      <div
                        key={w.id}
                        className={`flex items-center gap-3 py-3 ${i > 0 ? "border-t border-border-2" : ""}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-ink">{w.action}</div>
                          <div className="text-[11px] text-ink-3">
                            {emp?.name ?? "AI"} · {room?.name ?? "Room"}
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[10.5px] text-ink-3">
                          {new Date(w.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
