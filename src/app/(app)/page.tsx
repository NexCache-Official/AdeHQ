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
  CheckSquare,
  ClipboardCheck,
  Phone,
  Plus,
  ScrollText,
  Sparkles,
  UserPlus,
  Wrench,
} from "lucide-react";

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

  const quickActions = [
    { label: "Hire AI Employee", icon: UserPlus, onClick: ui.openHire },
    { label: "Create Channel", icon: Plus, onClick: ui.openCreateRoom },
    { label: "Start Workforce Call", icon: Phone, onClick: () => router.push("/calls") },
    { label: "Connect Tool", icon: Wrench, onClick: () => router.push("/tools") },
    { label: "View Work Log", icon: ScrollText, onClick: () => router.push("/work-log") },
  ];

  const stats = [
    { label: "AI employees", value: employees.length, icon: Bot, href: "/workforce" },
    { label: "Active channels", value: channels.length, icon: Sparkles, href: "/rooms" },
    { label: "Active tasks", value: activeTasks.length, icon: CheckSquare, href: "/tasks" },
    { label: "Pending approvals", value: pendingApprovals.length, icon: ClipboardCheck, href: "/approvals", alert: pendingApprovals.length > 0 },
  ];

  return (
    <PageContainer wide>
      {/* Hero */}
      <div className="relative mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-accent-100 blur-3xl" />
        <div className="absolute right-20 top-20 h-32 w-32 rounded-full bg-accent-50 blur-2xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-ring" />
              {workingCount} working now
            </span>
            <span>·</span>
            <span>{state.workspace.name}</span>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            My AI Workforce
          </h1>
          <p className="mt-2 max-w-xl text-[15px] text-slate-600">
            Welcome back, {state.user?.name?.split(" ")[0]}. Your AI employees are working across{" "}
            {channels.length} channels. Give them a task, review their work, or jump on a call.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {quickActions.map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-all hover:border-accent-300 hover:bg-accent-50"
              >
                <a.icon className="h-4 w-4 text-accent-600" />
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card hover className="flex items-center gap-3 p-4">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${s.alert ? "bg-amber-500/15 text-amber-700" : "bg-accent-500/12 text-accent-600"}`}>
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-semibold tracking-tight text-slate-900">{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left — workforce */}
        <div className="space-y-8 lg:col-span-2">
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

        {/* Right — activity + approvals */}
        <div className="space-y-8">
          <section>
            <SectionHeader title="Today's activity" href="/work-log" linkLabel="Work log" />
            <Card className="p-3">
              <WorkLogTimeline events={recentLog} compact />
            </Card>
          </section>

          <section>
            <SectionHeader title="Pending approvals" href="/approvals" linkLabel="All" />
            <div className="space-y-3">
              {pendingApprovals.length === 0 ? (
                <Card className="p-5 text-center text-sm text-slate-500">
                  You&apos;re all caught up — no pending approvals.
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
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
      <Link href={href} className="flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700">
        {linkLabel} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
