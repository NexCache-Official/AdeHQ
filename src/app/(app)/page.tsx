"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { partitionWorkforce } from "@/lib/maya-employee";
import { MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { getGroupRooms } from "@/lib/rooms";
import { canManageAiEmployees } from "@/lib/workspace/permissions";
import { canAccessMaya } from "@/lib/workspace/access";
import { useShellUI } from "@/components/AppShell";
import { EmployeeCard } from "@/components/EmployeeCard";
import { HomeActivityFeed } from "@/components/HomeActivityFeed";
import { UnclaimedInboxBanner } from "@/components/inbox/UnclaimedInboxBanner";
import { Bell, Plus, ScrollText, Settings, UserPlus } from "lucide-react";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const { state, actions } = useStore();
  const ui = useShellUI();
  const router = useRouter();

  const openEmployeeDm = (employeeId: string) => {
    const dm = actions.openOrCreateDM(employeeId);
    router.push(`/rooms/${dm.id}`);
  };

  const pendingApprovals = state.approvals.filter((a) => a.status === "pending");
  const activeTasks = state.tasks.filter((t) => t.status !== "done");
  const recentLog = [...state.workLog]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 6);
  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role;
  const canHire = canManageAiEmployees(myRole);
  const { hired, maya } = partitionWorkforce(state.employees);
  const visibleMaya = canAccessMaya(myRole) ? maya : [];
  const workingCount = hired.filter((e) => e.status === "working").length;
  const rooms = getGroupRooms(state.rooms);
  const firstName = state.user?.name?.split(" ")[0] ?? "there";
  const workforcePreview = [...visibleMaya, ...hired].slice(0, 4);

  const aiEmployeeCount = visibleMaya.length + hired.length;
  const stats = [
    {
      label: "AI employees",
      value: String(aiEmployeeCount),
      caption: visibleMaya.length
        ? `${MAYA_EMPLOYEE_NAME} included · ${workingCount} working`
        : `${workingCount} working now`,
      href: "/workforce",
    },
    { label: "Rooms", value: String(rooms.length), caption: "Active workstreams", href: "/rooms" },
    {
      label: "Open tasks",
      value: String(activeTasks.length),
      caption: "Across all rooms",
      href: "/tasks",
    },
    {
      label: "Approvals",
      value: String(pendingApprovals.length),
      caption: pendingApprovals.length ? "Needs review" : "All clear",
      href: "/approvals",
      alert: pendingApprovals.length > 0,
    },
    {
      label: "Memory",
      value: String(state.memory.length),
      caption: "Facts & decisions",
      href: "/memory",
    },
    {
      label: "Work log",
      value: String(state.workLog.length),
      caption: "AI actions tracked",
      href: "/work-log",
    },
  ];

  const heroSub =
    pendingApprovals.length > 0
      ? `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? "" : "s"} waiting — your team is active across ${rooms.length} room${rooms.length === 1 ? "" : "s"}.`
      : `Your AI employees are working across ${rooms.length} room${rooms.length === 1 ? "" : "s"}. Give them a task, review their work, or jump on a call.`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Home.dc top chrome */}
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-canvas/80 px-8 backdrop-blur-sm">
        <div className="flex items-center gap-2 font-mono text-[13.5px] tracking-[0.02em] text-ink-3">
          <span>WORKSPACE</span>
          <span className="text-[rgb(204_201_196)]">/</span>
          <span className="text-ink">HOME</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => router.push("/settings/notifications")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-muted hover:text-ink"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => router.push("/settings")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-muted hover:text-ink"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-12 pt-7">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-[22px]">
          <UnclaimedInboxBanner />

          {/* Hero */}
          <div className="relative overflow-hidden rounded-[18px] bg-[var(--hero-grad)] px-10 py-[38px] text-white">
            <div
              className="pointer-events-none absolute -right-[8%] -top-[45%] h-[520px] w-[520px] rounded-full"
              style={{
                background: "radial-gradient(circle, var(--hero-glow), transparent 68%)",
              }}
            />
            <div className="relative">
              <div className="mb-[18px] flex items-center gap-2 font-mono text-[12.5px] tracking-[0.03em] text-[rgb(180_176_172)]">
                <span className="h-[7px] w-[7px] rounded-full bg-[rgb(78_176_104)]" />
                <span>Workforce online · {state.workspace.name}</span>
              </div>
              <h1 className="max-w-[640px] text-[34px] font-semibold leading-[1.12] tracking-[-0.025em]">
                {greeting()}, {firstName}.
                <br />
                Your AI workforce is ready.
              </h1>
              <p className="mt-3.5 max-w-[520px] text-[15px] leading-relaxed text-[rgb(180_176_172)]">
                {heroSub}
              </p>
              <div className="mt-[26px] flex flex-wrap gap-2.5">
                {canHire && (
                  <button
                    type="button"
                    onClick={ui.openHire}
                    className="inline-flex items-center gap-2 rounded-[9px] bg-white px-4 py-2.5 text-[13.5px] font-semibold text-[rgb(27_22_18)] transition-colors hover:bg-[rgb(230_228_226)]"
                  >
                    <UserPlus className="h-4 w-4" strokeWidth={2} />
                    Hire AI employee
                  </button>
                )}
                <button
                  type="button"
                  onClick={ui.openCreateRoom}
                  className="inline-flex items-center gap-2 rounded-[9px] border border-white/16 px-[15px] py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-white/8"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} />
                  Create room
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/work-log")}
                  className="inline-flex items-center gap-2 rounded-[9px] border border-white/16 px-[15px] py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-white/8"
                >
                  <ScrollText className="h-4 w-4" strokeWidth={2} />
                  Review work log
                </button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {stats.map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className="rounded-xl border border-border bg-surface px-4 pb-[17px] pt-[15px] transition-colors hover:bg-muted/50"
              >
                <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
                  {s.label}
                </div>
                <div className="my-[11px] text-[30px] font-semibold leading-none tracking-[-0.02em] text-ink">
                  {s.value}
                  {s.alert ? (
                    <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber align-middle" />
                  ) : null}
                </div>
                <div className="text-[11.5px] text-ink-3">{s.caption}</div>
              </Link>
            ))}
          </div>

          <div className="grid items-start gap-[22px] lg:grid-cols-[1.35fr_1fr]">
            <section>
              <div className="mb-3.5 flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">Workforce status</h2>
                <Link
                  href="/workforce"
                  className="flex items-center gap-1 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-ink"
                >
                  View all
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                {workforcePreview.map((e) => (
                  <EmployeeCard key={e.id} employee={e} onMessage={(emp) => openEmployeeDm(emp.id)} />
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3.5 flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">Today&apos;s activity</h2>
                <Link
                  href="/work-log"
                  className="flex items-center gap-1 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-ink"
                >
                  Work log
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </div>
              <HomeActivityFeed events={recentLog} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
