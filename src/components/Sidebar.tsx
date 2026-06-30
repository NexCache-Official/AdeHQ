"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { getDirectMessages, getGroupChannels } from "@/lib/rooms";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "./AppShell";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
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
  MessageSquare,
  Search,
  Settings,
} from "lucide-react";

const WORKFORCE_NAV = [
  { href: "/workforce", label: "AI Workforce", icon: Bot },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, badgeKey: "tasks" as const },
  { href: "/memory", label: "Memory", icon: Brain },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck, badgeKey: "approvals" as const },
  { href: "/work-log", label: "Work Log", icon: ScrollText },
  { href: "/tools", label: "Tools", icon: Wrench },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state, actions } = useStore();
  const ui = useShellUI();

  const pendingApprovals = state.approvals.filter((a) => a.status === "pending").length;
  const openTasks = state.tasks.filter((t) => t.status !== "done").length;
  const channels = getGroupChannels(state.rooms);
  const dmRooms = getDirectMessages(state.rooms);
  const hasDmUnread = dmRooms.some((r) => r.unread > 0);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  const isRoomActive = (id: string) => pathname === `/rooms/${id}`;

  const openDM = (employeeId: string) => {
    const room = actions.openOrCreateDM(employeeId);
    router.push(`/rooms/${room.id}`);
  };

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col bg-rail lg:flex">
      <div className="flex flex-col gap-0.5 p-3 pb-2">
        <WorkspaceSwitcher variant="rail" />

        <div className="relative mb-2 mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-white/40" />
          <button
            type="button"
            onClick={ui.openCommand}
            className="flex w-full items-center justify-between rounded-[11px] border border-white/[0.09] bg-white/[0.03] py-2 pl-9 pr-2.5 text-left text-[12.5px] text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/70"
          >
            <span>Search or command</span>
            <span className="rounded-[5px] border border-white/[0.14] px-1.5 py-px font-mono text-[10px] text-white/35">
              ⌘K
            </span>
          </button>
        </div>

        <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/30">
          Workspace
        </p>
        <Link href="/" className={cn("nav-link", isActive("/", true) && "nav-link-active")}>
          <Home className="h-[17px] w-[17px]" strokeWidth={1.8} />
          <span className="flex-1">Home</span>
        </Link>
        <Link href="/rooms" className={cn("nav-link", isActive("/rooms") && "nav-link-active")}>
          <Hash className="h-[17px] w-[17px]" strokeWidth={1.8} />
          <span className="flex-1">Channels</span>
          {channels.length > 0 && (
            <span className="rounded-md bg-white/10 px-1.5 py-px font-mono text-[10.5px] text-white/70">
              {channels.length}
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => {
            const first = state.employees[0];
            if (first) openDM(first.id);
            else router.push("/workforce");
          }}
          className={cn(
            "nav-link w-full",
            dmRooms.some((r) => isRoomActive(r.id)) && "nav-link-active",
          )}
        >
          <MessageSquare className="h-[17px] w-[17px]" strokeWidth={1.8} />
          <span className="flex-1 text-left">Direct messages</span>
          {hasDmUnread && <span className="h-[7px] w-[7px] rounded-full bg-accent" />}
        </button>
        <Link href="/calls" className={cn("nav-link", isActive("/calls") && "nav-link-active")}>
          <Phone className="h-[17px] w-[17px]" strokeWidth={1.8} />
          <span className="flex-1">Calls</span>
        </Link>

        <p className="px-2.5 pb-1 pt-3.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/30">
          Workforce
        </p>
        {WORKFORCE_NAV.map((item) => {
          const active = isActive(item.href);
          const badge =
            item.badgeKey === "approvals"
              ? pendingApprovals
              : item.badgeKey === "tasks"
                ? openTasks
                : 0;
          return (
            <Link key={item.href} href={item.href} className={cn("nav-link", active && "nav-link-active")}>
              <item.icon className="h-[17px] w-[17px]" strokeWidth={1.8} />
              <span className="flex-1">{item.label}</span>
              {badge > 0 && (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-px font-mono text-[10.5px]",
                    item.badgeKey === "approvals"
                      ? "bg-accent text-white"
                      : "bg-white/10 text-white/70",
                  )}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Channel quick links when on rooms */}
      {channels.length > 0 && pathname.startsWith("/rooms") && (
        <div className="mx-3 mb-2 max-h-32 overflow-y-auto rounded-xl border border-white/[0.07] bg-white/[0.03] p-1.5">
          {channels.slice(0, 6).map((room) => (
            <Link
              key={room.id}
              href={`/rooms/${room.id}`}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/55 hover:bg-white/[0.06] hover:text-white",
                isRoomActive(room.id) && "bg-white/10 text-white",
              )}
            >
              <Hash className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="truncate">{room.name}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-auto border-t border-white/[0.07] p-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] p-2">
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#3B4C6B] to-[#5A6E94] text-xs font-bold text-white">
            {(state.user?.name ?? "U").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-white">
              {state.user?.name ?? "You"}
            </div>
            <div className="text-[11px] text-white/40">Owner</div>
          </div>
          <Link
            href="/settings"
            className="rounded-lg p-1 text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white"
            title="Settings"
          >
            <Settings className="h-[15px] w-[15px]" strokeWidth={1.8} />
          </Link>
        </div>
      </div>
    </aside>
  );
}
