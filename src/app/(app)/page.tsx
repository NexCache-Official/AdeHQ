"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { getGroupChannels } from "@/lib/rooms";
import { useShellUI } from "@/components/AppShell";
import { PageContainer } from "@/components/Page";
import { EmployeeCard } from "@/components/EmployeeCard";
import { ProjectRoomCard } from "@/components/ProjectRoomCard";
import { ApprovalCard } from "@/components/ApprovalCard";
import { WorkLogTimeline } from "@/components/WorkLogTimeline";
import { Card } from "@/components/ui";
import {
  ArrowRight,
  Bot,
  Brain,
  CheckSquare,
  ClipboardCheck,
  Hash,
  Phone,
  Plus,
  ScrollText,
  UserPlus,
  Wrench,
} from "lucide-react";

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

  const employees = state.employees;
  const pendingApprovals = state.approvals.filter((a) => a.status === "pending");
  const activeTasks = state.tasks.filter((t) => t.status !== "done");
  const recentLog = [...state.workLog]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 6);
  const workingCount = employees.filter((e) => e.status === "working").length;
  const channels = getGroupChannels(state.rooms);
  const firstName = state.user?.name?.split(" ")[0] ?? "there";

  const stats = [
    { label: "AI employees", value: employees.length, sub: `${workingCount} working now`, href: "/workforce" },
    { label: "Channels", value: channels.length, sub: "Active project rooms", href: "/rooms" },
    { label: "Open tasks", value: activeTasks.length, sub: "Across all rooms", href: "/tasks" },
    { label: "Approvals", value: pendingApprovals.length, sub: pendingApprovals.length ? "Needs review" : "All clear", href: "/approvals", alert: pendingApprovals.length > 0 },
    { label: "Memory", value: state.memory.length, sub: "Facts & decisions", href: "/memory" },
    { label: "Work log", value: state.workLog.length, sub: "AI actions tracked", href: "/work-log" },
  ];

  const heroSub =
    pendingApprovals.length > 0
      ? `${pendingApprovals.length} approval${pendingApprovals.length === 1 ? "" : "s"} waiting — your team is active across ${channels.length} channel${channels.length === 1 ? "" : "s"}.`
      : `Your AI employees are working across ${channels.length} channel${channels.length === 1 ? "" : "s"}. Give them a task, review their work, or jump on a call.`;

  return (
    <PageContainer wide className="pb-16">
      {/* Command center hero */}
      <div className="relative mb-[18px] overflow-hidden rounded-[22px] hero-dark p-8 text-white shadow-[0_20px_50px_-24px_rgba(40,30,15,0.5)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle,rgba(232,93,44,0.42),transparent_70%)] blur-[20px]" />
        <div className="pointer-events-none absolute bottom-[-90px] right-[120px] h-[220px] w-[220px] rounded-full bg-[radial-gradient(circle,rgba(242,151,78,0.22),transparent_70%)] blur-[10px]" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-white/60">
            <span className="h-[7px] w-[7px] rounded-full bg-green animate-glowpulse" />
            Workforce online · {state.workspace.name}
          </div>
          <h1 className="mt-3 text-[30px] font-bold leading-tight tracking-tight sm:text-[32px]">
            {greeting()}, {firstName}.
            <br />
            Your AI workforce is ready.
          </h1>
          <p className="mt-2 max-w-xl text-[14.5px] text-white/62">{heroSub}</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={ui.openHire}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white shadow-glow transition-all hover:brightness-105"
            >
              <UserPlus className="h-4 w-4" /> Hire AI Employee
            </button>
            <button
              type="button"
              onClick={ui.openCreateRoom}
              className="inline-flex items-center gap-2 rounded-xl border border-white/16 bg-white/[0.06] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/10"
            >
              <Plus className="h-4 w-4" /> Create channel
            </button>
            <button
              type="button"
              onClick={() => router.push("/calls")}
              className="inline-flex items-center gap-2 rounded-xl border border-white/16 bg-white/[0.06] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/10"
            >
              <Phone className="h-4 w-4" /> Start workforce call
            </button>
            <button
              type="button"
              onClick={() => router.push("/work-log")}
              className="inline-flex items-center gap-2 rounded-xl border border-white/16 bg-white/[0.06] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/10"
            >
              <ScrollText className="h-4 w-4" /> Review work log
            </button>
          </div>
        </div>
      </div>

      {/* Stat strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card hover className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-semibold tracking-wide text-ink-2">{s.label}</span>
                {s.alert && <span className="h-2 w-2 rounded-full bg-amber" />}
              </div>
              <div className="mt-2 font-mono text-[26px] font-bold tracking-tight text-ink">{s.value}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">{s.sub}</div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.55fr_1fr] lg:gap-[22px]">
        <div className="flex flex-col gap-6 lg:gap-6">
          <section>
            <SectionHeader title="Workforce status" href="/workforce" linkLabel="View all" />
            <div className="grid gap-3 sm:grid-cols-2">
              {employees.slice(0, 4).map((e) => (
                <EmployeeCard key={e.id} employee={e} onMessage={(emp) => openEmployeeDm(emp.id)} />
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title="Active channels" href="/rooms" linkLabel="All channels" />
            <div className="grid gap-3 sm:grid-cols-2">
              {channels.map((r) => (
                <ProjectRoomCard key={r.id} room={r} />
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <SectionHeader title="Today&apos;s activity" href="/work-log" linkLabel="Work log" />
            <Card className="px-4 py-2">
              <WorkLogTimeline events={recentLog} compact />
            </Card>
          </section>

          <section>
            <SectionHeader title="Pending approvals" href="/approvals" linkLabel="All" />
            <div className="space-y-3">
              {pendingApprovals.length === 0 ? (
                <Card className="border-dashed p-6 text-center text-sm text-ink-3">
                  You&apos;re all caught up.
                </Card>
              ) : (
                pendingApprovals.slice(0, 3).map((a) => <ApprovalCard key={a.id} approval={a} />)
              )}
            </div>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}

function SectionHeader({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-3.5 flex items-center justify-between">
      <h2 className="text-base font-bold tracking-tight text-ink">{title}</h2>
      <Link
        href={href}
        className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-d"
      >
        {linkLabel} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
