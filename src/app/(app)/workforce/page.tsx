"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "@/components/AppShell";
import { useWorkspaceUsage } from "@/hooks/useWorkspaceUsage";
import { partitionWorkforce } from "@/lib/maya-employee";
import { MAYA_EMPLOYEE_NAME, MAYA_WORKFORCE_BADGE } from "@/lib/hiring/maya";
import { EmployeeCard } from "@/components/EmployeeCard";
import { avatarGradient, initials } from "@/lib/utils";
import { Bot, Plus, Sparkles, UserPlus } from "lucide-react";

const DEPARTMENTS = [
  { name: "Sales", color: "#2F6FED" },
  { name: "Research", color: "#0EA5E9" },
  { name: "Ops", color: "#8B5CF6" },
  { name: "Support", color: "#10B981" },
];

const PIPELINE = [
  { role: "Outbound SDR", stage: "Interviewing candidates", pct: 65, accent: "#2F6FED" },
  { role: "Competitive Intel", stage: "Defining scope", pct: 30, accent: "#0EA5E9" },
];

const RECOMMENDATIONS = [
  {
    title: "Add a Research analyst",
    why: "Your Research room has 3 open topics with no dedicated analyst assigned.",
  },
  {
    title: "Review pooled Work Hours",
    why: "AI Work Hours are shared across the whole workforce — check Usage if replies slow near period limits.",
  },
];

export default function WorkforcePage() {
  const { state, actions } = useStore();
  const ui = useShellUI();
  const router = useRouter();
  const { data: usage } = useWorkspaceUsage(state.workspace.id);

  const openEmployeeDm = (employeeId: string) => {
    const dm = actions.openOrCreateDM(employeeId);
    router.push(`/rooms/${dm.id}`);
  };

  const { maya, hired } = partitionWorkforce(state.employees);

  const deptCounts = useMemo(() => {
    const counts = DEPARTMENTS.map((d) => ({ ...d, count: 0 }));
    hired.forEach((e, i) => {
      counts[i % counts.length].count += 1;
    });
    return counts;
  }, [hired]);

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
            <h1 className="text-2xl font-bold tracking-tight text-ink">AI Workforce</h1>
            <p className="mt-1 text-sm text-ink-2">
              {hired.length} hired employee{hired.length === 1 ? "" : "s"}
              {maya.length > 0 ? ` · ${MAYA_EMPLOYEE_NAME} included` : ""}
              {usage?.capacity
                ? usage.capacity.unlimited
                  ? " · Unlimited AI Work Hours"
                  : ` · ${(usage.capacity.used ?? 0).toFixed(2)} of ${(usage.capacity.allowance ?? 0).toFixed(2)} AI Work Hours used`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={ui.openHire}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_-6px_rgba(47,111,237,0.5)] transition-all hover:brightness-105"
          >
            <UserPlus className="h-4 w-4" strokeWidth={2} />
            Hire AI Employee
          </button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {deptCounts.map((d) => (
            <div
              key={d.name}
              className="flex items-center gap-3 rounded-[14px] border border-border bg-surface p-3.5"
            >
              <span
                className="h-[34px] w-[34px] shrink-0 rounded-[10px] opacity-20"
                style={{ background: d.color }}
              />
              <div>
                <div className="font-mono text-xl font-bold leading-none text-ink">{d.count}</div>
                <div className="mt-0.5 text-xs text-ink-2">{d.name}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div>
            {maya.length > 0 && (
              <>
                <h2 className="mb-3 text-base font-bold text-ink">{MAYA_WORKFORCE_BADGE}</h2>
                <div className="mb-6 grid gap-3 sm:grid-cols-2">
                  {maya.map((employee) => (
                    <EmployeeCard
                      key={employee.id}
                      employee={employee}
                      badge={MAYA_WORKFORCE_BADGE}
                      onMessage={(emp) => openEmployeeDm(emp.id)}
                    />
                  ))}
                </div>
              </>
            )}

            <h2 className="mb-3 text-base font-bold text-ink">Your AI employees</h2>
            {hired.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center text-sm text-ink-3">
                <Bot className="mx-auto mb-2 h-8 w-8 opacity-40" />
                No AI employees yet. Hire your first teammate to get started.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {hired.map((e) => (
                  <EmployeeCard key={e.id} employee={e} onMessage={(emp) => openEmployeeDm(emp.id)} />
                ))}
              </div>
            )}

            {recentWork.length > 0 && (
              <>
                <h2 className="mb-3 mt-7 text-base font-bold text-ink">Recent employee work</h2>
                <div className="rounded-2xl border border-border bg-surface px-4 py-1">
                  {recentWork.map((w, i) => {
                    const emp = state.employees.find((e) => e.id === w.employeeId);
                    const room = state.rooms.find((r) => r.id === w.roomId);
                    const name = emp?.name ?? "AI";
                    return (
                      <div
                        key={w.id}
                        className={`flex items-center gap-3 py-3 ${i > 0 ? "border-t border-border-2" : ""}`}
                      >
                        <span
                          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-[11px] font-bold text-white"
                          style={{
                            backgroundImage: avatarGradient(emp?.accent ?? "#64748B"),
                          }}
                        >
                          {initials(name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-ink">{w.action}</div>
                          <div className="text-[11px] text-ink-3">
                            {room?.name ?? "Room"} · {w.summary}
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
              </>
            )}
          </div>

          <div className="flex flex-col gap-6">
            <section>
              <h2 className="mb-3 text-base font-bold text-ink">Hiring pipeline</h2>
              <div className="flex flex-col gap-2.5">
                {PIPELINE.map((p) => (
                  <div
                    key={p.role}
                    className="rounded-[15px] border border-border bg-surface p-3.5"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] text-white"
                        style={{ backgroundImage: avatarGradient(p.accent) }}
                      >
                        <UserPlus className="h-4 w-4" strokeWidth={1.9} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold text-ink">{p.role}</div>
                        <div className="text-[11.5px] text-ink-2">{p.stage}</div>
                      </div>
                    </div>
                    <div className="mt-3 h-[5px] overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-accent"
                        style={{ width: `${p.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={ui.openHire}
                  className="flex items-center justify-center gap-1.5 rounded-[15px] border border-dashed border-border bg-surface p-3.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-muted"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} />
                  Start a new hire
                </button>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-base font-bold text-ink">Recommendations</h2>
              <div className="flex flex-col gap-2.5">
                {RECOMMENDATIONS.map((rec) => (
                  <div
                    key={rec.title}
                    className="rounded-[15px] border border-border bg-gradient-to-b from-[#FFFAF6] to-surface p-3.5"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-accent-soft text-accent-d">
                        <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                      </span>
                      <span className="text-[13.5px] font-semibold text-ink">{rec.title}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-ink-2">{rec.why}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
