"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  findDmRoomForEmployee,
  getDirectMessages,
  getGroupRooms,
  isDirectMessage,
} from "@/lib/rooms";
import { isMayaEmployee, partitionWorkforce } from "@/lib/maya-employee";
import { MAYA_WORKFORCE_BADGE } from "@/lib/hiring/maya";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE, WORKFORCE_CALLS_ENABLED } from "@/lib/config/features";
import { useShellUI } from "./AppShell";
import { useDebugTrace } from "./DebugProvider";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { SidebarWorkHoursMeter } from "./SidebarWorkHoursMeter";
import { roleLabel } from "@/lib/workspace/permissions";
import { Toggle } from "./ui";
import { EmployeeAvatar } from "./EmployeeAvatar";
import {
  SidebarCollapsibleSection,
  SidebarNestedButton,
  SidebarNestedLink,
} from "./SidebarCollapsibleSection";
import { fetchInboxUnreadCount } from "@/lib/inbox/client";
import {
  CalendarDays,
  TrendingUp,
  Bot,
  Briefcase,
  CheckSquare,
  Brain,
  ClipboardCheck,
  ScrollText,
  Wrench,
  Phone,
  Home,
  Hash,
  HardDrive,
  Mail,
  MessageSquare,
  Plus,
  Search,
  Settings,
  LogOut,
  RotateCcw,
  ChevronUp,
  UserPlus,
  Bug,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const WORKFORCE_NAV = [
  { href: "/workforce", label: "AI Workforce", icon: Bot },
  { href: "/crm", label: "CRM", icon: Briefcase },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/investors", label: "Investors", icon: TrendingUp },
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
  const { state, actions, backend } = useStore();
  const ui = useShellUI();
  const { enabled: debugEnabled, setEnabled: setDebugEnabled } = useDebugTrace();
  const [profileOpen, setProfileOpen] = useState(false);
  const [inboxUnread, setInboxUnread] = useState(0);

  useEffect(() => {
    const workspaceId = state.workspace?.id;
    if (!workspaceId) {
      setInboxUnread(0);
      return;
    }
    let cancelled = false;
    const load = () => {
      void fetchInboxUnreadCount(workspaceId)
        .then((n) => {
          if (!cancelled) setInboxUnread(n);
        })
        .catch(() => {
          if (!cancelled) setInboxUnread(0);
        });
    };
    load();
    // Faster while on Inbox so mission "needs input" badges stay fresh.
    const intervalMs = pathname?.startsWith("/inbox") ? 15_000 : 60_000;
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state.workspace?.id, pathname]);

  const workingCount = state.employees.filter((e) => e.status === "working").length;
  const pendingApprovals = state.approvals.filter((a) => a.status === "pending").length;
  const openTasks = state.tasks.filter((t) => t.status !== "done").length;
  const rooms = getGroupRooms(state.rooms);
  const { maya, hired } = partitionWorkforce(state.employees);
  const sidebarDmEmployees = [...maya, ...hired];
  const dmRooms = getDirectMessages(state.rooms);
  const hasDmUnread = dmRooms.some((r) => r.unread > 0);

  const activeRoomId = pathname.match(/^\/rooms\/([^/]+)/)?.[1];
  const activeRoom = useMemo(
    () => (activeRoomId ? state.rooms.find((r) => r.id === activeRoomId) : undefined),
    [activeRoomId, state.rooms],
  );
  const onGroupRoom = activeRoom && !isDirectMessage(activeRoom);
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
    <aside className="flex h-full w-full min-w-0 flex-col border-r border-[var(--rail-edge)] bg-rail">
      {/* Fixed: workspace → search */}
      <div className="shrink-0 space-y-2 border-b border-[var(--rail-edge)]/70 px-3 pb-2.5 pt-3.5">
        <WorkspaceSwitcher
          variant="rail"
          onCreateWorkspace={() => router.push("/workspaces/new")}
        />
        <SidebarWorkHoursMeter />

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[var(--rail-ink-3)]" />
          <button
            type="button"
            onClick={ui.openCommand}
            className="flex w-full items-center justify-between rounded-[11px] border border-[var(--rail-border)] bg-[var(--rail-fill)] py-2 pl-9 pr-2.5 text-left text-[12.5px] text-[var(--rail-ink-2)] transition-colors hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]"
          >
            <span className="min-w-0 flex-1 truncate">Search or command</span>
            <span className="shrink-0 rounded-[5px] border border-[var(--rail-border)] px-1.5 py-px font-mono text-[10px] text-[var(--rail-ink-3)]">
              ⌘K
            </span>
          </button>
        </div>
      </div>

      {/* Scrollable middle nav */}
      <div className="rail-scroll flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto overflow-x-hidden px-3 py-2.5">
        <p className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--rail-ink-3)]">
          Workspace
        </p>
        <Link href="/" className={cn("nav-link", isActive("/", true) && "nav-link-active")}>
          <Home className="h-[17px] w-[17px]" strokeWidth={1.8} />
          <span className="flex-1 truncate">Home</span>
        </Link>

        <Link href="/inbox" className={cn("nav-link", isActive("/inbox") && "nav-link-active")}>
          <Mail className="h-[17px] w-[17px]" strokeWidth={1.8} />
          <span className="flex-1 truncate">Inbox</span>
          {unreadBadge(inboxUnread)}
        </Link>

        <Link href="/drive" className={cn("nav-link", isActive("/drive") && "nav-link-active")}>
          <HardDrive className="h-[17px] w-[17px]" strokeWidth={1.8} />
          <span className="flex-1 truncate">AdeHQ Drive</span>
        </Link>

        <SidebarCollapsibleSection
          storageKey="adehq.sidebar.rooms"
          label="Rooms"
          icon={Hash}
          href="/rooms"
          count={rooms.length}
          isSectionActive={pathname === "/rooms" || !!onGroupRoom}
          forceOpen={!!onGroupRoom}
          headerAction={
            <button
              type="button"
              onClick={ui.openCreateRoom}
              title="Create room"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--rail-ink-3)] transition-colors hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          }
        >
          {rooms.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] leading-relaxed text-[var(--rail-ink-3)]">No rooms yet</p>
          ) : (
            rooms.slice(0, MAX_SIDEBAR_ITEMS).map((room) => (
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
          {rooms.length > MAX_SIDEBAR_ITEMS && (
            <SidebarNestedLink
              href="/rooms"
              icon={<Hash className="h-3.5 w-3.5 opacity-50" strokeWidth={2} />}
              label={`+${rooms.length - MAX_SIDEBAR_ITEMS} more`}
            />
          )}
        </SidebarCollapsibleSection>

        <SidebarCollapsibleSection
          storageKey="adehq.sidebar.dms"
          label="Direct messages"
          icon={MessageSquare}
          href="/dm"
          count={sidebarDmEmployees.length}
          showUnreadDot={hasDmUnread}
          isSectionActive={pathname === "/dm" || !!onDmRoom}
          forceOpen={!!onDmRoom}
        >
          {sidebarDmEmployees.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] leading-relaxed text-[var(--rail-ink-3)]">
              Maya will appear here once your workspace loads
            </p>
          ) : (
            sidebarDmEmployees.slice(0, MAX_SIDEBAR_ITEMS).map((employee) => {
              const dm = findDmRoomForEmployee(state.rooms, employee.id);
              const active = dm ? activeRoomId === dm.id : false;
              const isMaya = isMayaEmployee(employee);
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
                    />
                  }
                  label={employee.name}
                  badge={
                    isMaya ? (
                      <span className="ml-auto shrink-0 rounded-full bg-[var(--rail-badge-bg)] px-1.5 font-mono text-[9px] text-[var(--rail-badge-ink)]">
                        {MAYA_WORKFORCE_BADGE}
                      </span>
                    ) : dm ? (
                      unreadBadge(dm.unread)
                    ) : undefined
                  }
                />
              );
            })
          )}
          {sidebarDmEmployees.length > MAX_SIDEBAR_ITEMS && (
            <SidebarNestedLink
              href="/dm"
              icon={<MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />}
              label={`+${sidebarDmEmployees.length - MAX_SIDEBAR_ITEMS} more`}
            />
          )}
        </SidebarCollapsibleSection>

        <Link href="/calls" className={cn("nav-link", isActive("/calls") && "nav-link-active")}>
          <Phone className="h-[17px] w-[17px]" strokeWidth={1.8} />
          <span className="flex-1 truncate">Calls</span>
          {!WORKFORCE_CALLS_ENABLED && (
            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
              Soon
            </span>
          )}
        </Link>

        <p className="px-2.5 pb-1 pt-3.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--rail-ink-3)]">
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
              <span className="flex-1 truncate">{item.label}</span>
              {badge > 0 && (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-px font-mono text-[10.5px]",
                    item.badgeKey === "approvals"
                      ? "bg-accent text-white"
                      : "bg-[var(--rail-badge-bg)] text-[var(--rail-badge-ink)]",
                  )}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Fixed: hire + profile */}
      <div className="relative shrink-0 space-y-2 border-t border-[var(--rail-edge)] px-3 pb-3 pt-3">
        {workingCount > 0 && (
          <div className="flex min-w-0 items-center gap-1.5 rounded-[10px] border border-green/20 bg-green-soft px-2.5 py-1.5 text-[11px] font-medium text-green">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green animate-glowpulse" />
            <span className="min-w-0 truncate">{workingCount} working now</span>
          </div>
        )}

        <button
          type="button"
          onClick={ui.openHire}
          className="group flex w-full min-w-0 flex-col items-center gap-0.5 rounded-[11px] bg-accent px-2.5 py-2.5 text-white shadow-glow transition-all hover:brightness-105 active:scale-[0.99]"
        >
          <span className="flex min-w-0 items-center justify-center gap-2 text-[12.5px] font-semibold">
            <UserPlus className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="min-w-0 truncate">Hire AI Employee</span>
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/70">
            Open role
          </span>
        </button>

        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors",
            profileOpen
              ? "border-[var(--rail-border)] bg-[var(--rail-hover)]"
              : "border-[var(--rail-border)] hover:bg-[var(--rail-hover)]",
          )}
          aria-expanded={profileOpen}
          aria-haspopup="menu"
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#3B4C6B] to-[#5A6E94] text-xs font-bold text-white">
            {(state.user?.name ?? "U").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-[var(--rail-ink)]">
              {state.user?.name ?? "You"}
            </div>
            <div className="truncate text-[11px] text-[var(--rail-ink-3)]">
              {roleLabel(
                state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role,
              )}
            </div>
          </div>
          <ChevronUp
            className={cn(
              "h-4 w-4 shrink-0 text-[var(--rail-ink-3)] transition-transform duration-200",
              profileOpen && "rotate-180",
            )}
            strokeWidth={2}
          />
        </button>

        <AnimatePresence>
          {profileOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setProfileOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-xl border border-border bg-surface shadow-lift"
              >
                <div className="border-b border-border-2 px-3 py-2.5">
                  <div className="truncate text-sm font-medium text-ink">{state.user?.name}</div>
                  <div className="truncate text-xs text-ink-3">{state.user?.email}</div>
                </div>
                <div className="p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      router.push("/settings");
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-muted hover:text-ink"
                  >
                    <Settings className="h-4 w-4" strokeWidth={1.8} /> Settings
                  </button>
                  <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-2.5 text-sm text-ink-2">
                      <Bug className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      <span>Debug trace</span>
                    </div>
                    <Toggle checked={debugEnabled} onChange={setDebugEnabled} />
                  </div>
                  {backend === "demo" && ENABLE_DEMO_MODE && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            "Reset all demo data? This restores the original demo workspace.",
                          )
                        ) {
                          actions.resetDemoData();
                          setProfileOpen(false);
                        }
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-muted hover:text-ink"
                    >
                      <RotateCcw className="h-4 w-4" strokeWidth={1.8} /> Reset demo data
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      actions.logout();
                      router.replace("/login");
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-danger transition-colors hover:bg-danger-soft"
                  >
                    <LogOut className="h-4 w-4" strokeWidth={1.8} /> Log out
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}
