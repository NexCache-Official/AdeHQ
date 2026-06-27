"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "./AppShell";
import { EmployeeAvatar } from "./EmployeeAvatar";
import {
  Bot,
  CheckSquare,
  Brain,
  ClipboardCheck,
  ScrollText,
  Wrench,
  Phone,
  Home,
  Hash,
  Plus,
  ChevronDown,
  Sparkles,
  Lock,
} from "lucide-react";

const WORKSPACE_NAV = [
  { href: "/workforce", label: "AI Workforce", icon: Bot },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck, badgeKey: "approvals" },
  { href: "/work-log", label: "Work Log", icon: ScrollText },
  { href: "/tools", label: "Tools", icon: Wrench },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state, actions, backend } = useStore();
  const ui = useShellUI();
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);

  const pendingApprovals = state.approvals.filter((a) => a.status === "pending").length;
  const channels = state.rooms.filter((r) => r.kind !== "dm");
  const dmRooms = state.rooms.filter((r) => r.kind === "dm");

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  const isRoomActive = (id: string) => pathname === `/rooms/${id}`;

  const openDM = (employeeId: string) => {
    const room = actions.openOrCreateDM(employeeId);
    router.push(`/rooms/${room.id}`);
  };

  return (
    <aside className="hidden w-[262px] shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-glow-amber shadow-glow-sm">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-slate-900">AdeHQ</div>
          <div className="text-[11px] text-slate-500">AI Workforce</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {/* Home */}
        <Link href="/" className={cn("nav-link", isActive("/", true) && "nav-link-active")}>
          <Home className="h-[18px] w-[18px]" strokeWidth={isActive("/", true) ? 2.2 : 1.8} />
          <span className="flex-1">Home</span>
        </Link>

        {/* Channels */}
        <div className="pt-3">
          <div className="group flex items-center gap-1 px-3 pb-1">
            <button
              onClick={() => setChannelsOpen((v) => !v)}
              className="flex flex-1 items-center gap-1 text-left section-title transition-colors hover:text-slate-700"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", !channelsOpen && "-rotate-90")} />
              Channels
            </button>
            <button
              onClick={ui.openCreateRoom}
              className="rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              title="Create channel"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {channelsOpen &&
            channels.map((room) => {
              const active = isRoomActive(room.id);
              return (
                <Link
                  key={room.id}
                  href={`/rooms/${room.id}`}
                  className={cn("nav-link !py-1.5", active && "nav-link-active")}
                >
                  <Hash className="h-[16px] w-[16px] shrink-0 text-slate-400" strokeWidth={2} />
                  <span className="flex-1 truncate">{room.name}</span>
                  {room.unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[11px] font-semibold text-white">
                      {room.unread}
                    </span>
                  )}
                </Link>
              );
            })}
        </div>

        {/* Direct messages */}
        <div className="pt-3">
          <div className="flex items-center gap-1 px-3 pb-1">
            <button
              onClick={() => setDmsOpen((v) => !v)}
              className="flex flex-1 items-center gap-1 text-left section-title transition-colors hover:text-slate-700"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", !dmsOpen && "-rotate-90")} />
              Direct Messages
            </button>
            <Lock className="h-3 w-3 text-slate-300" />
          </div>
          {dmsOpen &&
            state.employees.map((e) => {
              const dm = dmRooms.find((r) => r.dmEmployeeId === e.id);
              const active = dm ? isRoomActive(dm.id) : false;
              return (
                <button
                  key={e.id}
                  onClick={() => openDM(e.id)}
                  className={cn("nav-link w-full !py-1.5", active && "nav-link-active")}
                >
                  <EmployeeAvatar employee={e} size="xs" className="!h-5 !w-5" />
                  <span className="flex-1 truncate text-left">{e.name}</span>
                  {dm && dm.unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[11px] font-semibold text-white">
                      {dm.unread}
                    </span>
                  )}
                </button>
              );
            })}
        </div>

        {/* Calls — right below the conversation areas */}
        <div className="pt-3">
          <Link href="/calls" className={cn("nav-link", isActive("/calls") && "nav-link-active")}>
            <Phone className="h-[18px] w-[18px]" strokeWidth={isActive("/calls") ? 2.2 : 1.8} />
            <span className="flex-1">Calls</span>
          </Link>
        </div>

        {/* Workspace tools */}
        <p className="px-3 pb-1.5 pt-4 section-title">Workspace</p>
        {WORKSPACE_NAV.map((item) => {
          const active = isActive(item.href);
          const badge = item.badgeKey === "approvals" ? pendingApprovals : 0;
          return (
            <Link key={item.href} href={item.href} className={cn("nav-link", active && "nav-link-active")}>
              <item.icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.2 : 1.8} />
              <span className="flex-1">{item.label}</span>
              {badge > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/20 px-1.5 text-[11px] font-semibold text-amber-700">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-accent-50 px-3 py-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-ring" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-xs font-medium text-slate-700">
              {state.employees.filter((e) => e.status === "working").length} employees working
            </div>
            <div className="text-[11px] text-slate-500">
              {backend === "demo" ? "Demo workspace" : state.settings.mode === "live" ? "Live AI route" : "Mock AI mode"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
