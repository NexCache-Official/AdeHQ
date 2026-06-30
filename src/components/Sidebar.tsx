"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  findDmRoomForEmployee,
  getDirectMessages,
  getGroupChannels,
  isDirectMessage,
} from "@/lib/rooms";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "./AppShell";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { EmployeeAvatar } from "./EmployeeAvatar";
import {
  SidebarCollapsibleSection,
  SidebarNestedButton,
  SidebarNestedLink,
} from "./SidebarCollapsibleSection";
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
  Plus,
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

const MAX_SIDEBAR_ITEMS = 12;

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

  const activeRoomId = pathname.match(/^\/rooms\/([^/]+)/)?.[1];
  const activeRoom = useMemo(
    () => (activeRoomId ? state.rooms.find((r) => r.id === activeRoomId) : undefined),
    [activeRoomId, state.rooms],
  );
  const onChannelRoom = activeRoom && !isDirectMessage(activeRoom);
  const onDmRoom = activeRoom && isDirectMessage(activeRoom);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  const openDM = (employeeId: string) => {
    const room = actions.openOrCreateDM(employeeId);
    router.push(`/rooms/${room.id}`);
  };

  const unreadBadge = (count: number) =>
    count > 0 ? (
      <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 font-mono text-[9.5px] font-semibold text-white">
        {count}
      </span>
    ) : null;

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col bg-rail lg:flex">
      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-3 py-3.5">
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

        <SidebarCollapsibleSection
          storageKey="adehq.sidebar.channels"
          label="Channels"
          icon={Hash}
          href="/rooms"
          count={channels.length}
          isSectionActive={pathname === "/rooms" || !!onChannelRoom}
          forceOpen={!!onChannelRoom}
          headerAction={
            <button
              type="button"
              onClick={ui.openCreateRoom}
              title="Create channel"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          }
        >
          {channels.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] leading-relaxed text-white/35">No channels yet</p>
          ) : (
            channels.slice(0, MAX_SIDEBAR_ITEMS).map((room) => (
              <SidebarNestedLink
                key={room.id}
                href={`/rooms/${room.id}`}
                active={activeRoomId === room.id}
                icon={<Hash className="h-3.5 w-3.5" strokeWidth={2} />}
                label={room.name}
                badge={unreadBadge(room.unread)}
              />
            ))
          )}
          {channels.length > MAX_SIDEBAR_ITEMS && (
            <SidebarNestedLink
              href="/rooms"
              icon={<Hash className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />}
              label={`+${channels.length - MAX_SIDEBAR_ITEMS} more`}
            />
          )}
        </SidebarCollapsibleSection>

        <SidebarCollapsibleSection
          storageKey="adehq.sidebar.dms"
          label="Direct messages"
          icon={MessageSquare}
          href="/dm"
          count={state.employees.length}
          showUnreadDot={hasDmUnread}
          isSectionActive={pathname === "/dm" || !!onDmRoom}
          forceOpen={!!onDmRoom}
        >
          {state.employees.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] leading-relaxed text-white/35">
              Hire an AI employee to DM
            </p>
          ) : (
            state.employees.slice(0, MAX_SIDEBAR_ITEMS).map((employee) => {
              const dm = findDmRoomForEmployee(state.rooms, employee.id);
              const active = dm ? activeRoomId === dm.id : false;
              return (
                <SidebarNestedButton
                  key={employee.id}
                  onClick={() => openDM(employee.id)}
                  active={active}
                  icon={
                    <EmployeeAvatar
                      employee={employee}
                      size="xs"
                      showStatus={false}
                      className="!h-4 !w-4 !rounded-[5px] !text-[8px]"
                    />
                  }
                  label={employee.name}
                  badge={dm ? unreadBadge(dm.unread) : undefined}
                />
              );
            })
          )}
          {state.employees.length > MAX_SIDEBAR_ITEMS && (
            <SidebarNestedLink
              href="/dm"
              icon={<MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />}
              label={`+${state.employees.length - MAX_SIDEBAR_ITEMS} more`}
            />
          )}
        </SidebarCollapsibleSection>

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

      <div className="mt-auto px-3 pb-3 pt-3">
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
