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
import {
  ARTIFACTS_V1,
  ENABLE_DEMO_MODE,
  PLAYBOOKS_V1,
  WORKFORCE_CALLS_ENABLED,
} from "@/lib/config/features";
import { useShellUI } from "./AppShell";
import { useDebugTrace } from "./DebugProvider";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { SidebarWorkHoursMeter } from "./SidebarWorkHoursMeter";
import { canManageAiEmployees, roleLabel } from "@/lib/workspace/permissions";
import { canAccessMaya } from "@/lib/workspace/access";
import { Toggle } from "./ui";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { avatarAccentForId } from "@/lib/avatar-accent";
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
  BookOpen,
  FileStack,
  HardDrive,
  Mail,
  Plus,
  Settings,
  LogOut,
  RotateCcw,
  ChevronUp,
  UserPlus,
  Bug,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const WORKFORCE_NAV = [
  { href: "/workforce", label: "Workforce", icon: Bot },
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
    if (!workspaceId || backend === "demo") {
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
  }, [state.workspace?.id, pathname, backend]);

  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role;
  const canHire = canManageAiEmployees(myRole);
  const showMaya = canAccessMaya(myRole);
  const workingCount = state.employees.filter((e) => e.status === "working").length;
  const pendingApprovals = state.approvals.filter((a) => a.status === "pending").length;
  const openTasks = state.tasks.filter((t) => t.status !== "done").length;
  const rooms = getGroupRooms(state.rooms);
  const { maya, hired } = partitionWorkforce(state.employees);
  const sidebarDmEmployees = [...(showMaya ? maya : []), ...hired];
  const humanPeers = state.workspaceMembers.filter(
    (m) => m.userId !== state.user?.id && m.status !== "removed",
  );
  const dmRooms = getDirectMessages(state.rooms);
  const hasDmUnread = dmRooms.some((r) => r.unread > 0);
  const sidebarDmCount = sidebarDmEmployees.length + humanPeers.length;
  const dmUnreadTotal = dmRooms.reduce((sum, r) => sum + (r.unread || 0), 0);

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

  const openHumanDM = (peerUserId: string) => {
    const room = actions.openOrCreateHumanDM(peerUserId);
    router.push(`/rooms/${room.id}`);
  };

  const unreadBadge = (count: number) =>
    count > 0 ? (
      <span className="ml-auto shrink-0 rounded-full bg-[var(--rail-ink)] px-1.5 font-mono text-[10px] font-medium text-white">
        {count}
      </span>
    ) : null;

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r border-[var(--rail-edge)] bg-rail">
      {/* Fixed: workspace → work hours → search */}
      <div className="shrink-0 px-3 pb-0 pt-3.5">
        <WorkspaceSwitcher
          variant="rail"
          onCreateWorkspace={() => router.push("/workspaces/new")}
        />
        <div className="mt-2 px-0 pb-2.5 pt-0.5">
          <SidebarWorkHoursMeter />
        </div>

        <div className="pb-3">
          <button
            type="button"
            onClick={ui.openCommand}
            className="flex w-full items-center gap-2 rounded-[9px] border border-[var(--rail-border)] bg-[var(--rail-fill)] px-2.5 py-[7px] text-left text-[13px] text-[var(--rail-ink-3)] transition-colors hover:bg-[var(--rail-hover)] hover:text-[var(--rail-ink)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden className="shrink-0 opacity-80">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <span className="min-w-0 flex-1 truncate">Search or command</span>
            <span className="shrink-0 rounded-[5px] border border-[var(--rail-edge)] bg-[var(--rail)] px-[5px] py-px font-mono text-[10.5px] text-[var(--rail-ink-3)]">
              ⌘K
            </span>
          </button>
        </div>
      </div>

      {/* Scrollable middle nav */}
      <div className="rail-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2.5 pb-2.5 pt-1">
        <p className="rail-section-label">Workspace</p>
        <Link href="/" className={cn("nav-link", isActive("/", true) && "nav-link-active")}>
          <Home className="h-4 w-4" strokeWidth={1.9} />
          <span className="flex-1 truncate">Home</span>
        </Link>

        <Link href="/inbox" className={cn("nav-link", isActive("/inbox") && "nav-link-active")}>
          <Mail className="h-4 w-4" strokeWidth={1.9} />
          <span className="flex-1 truncate">Inbox</span>
          {unreadBadge(inboxUnread)}
        </Link>

        {PLAYBOOKS_V1 && (
          <Link
            href="/playbooks"
            className={cn("nav-link", isActive("/playbooks") && "nav-link-active")}
          >
            <BookOpen className="h-4 w-4" strokeWidth={1.9} />
            <span className="flex-1 truncate">Playbooks</span>
          </Link>
        )}

        {ARTIFACTS_V1 && (
          <Link
            href="/artifacts"
            className={cn("nav-link", isActive("/artifacts") && "nav-link-active")}
          >
            <FileStack className="h-4 w-4" strokeWidth={1.9} />
            <span className="flex-1 truncate">Artifacts</span>
          </Link>
        )}

        <Link href="/drive" className={cn("nav-link", isActive("/drive") && "nav-link-active")}>
          <HardDrive className="h-4 w-4" strokeWidth={1.9} />
          <span className="flex-1 truncate">AdeHQ Drive</span>
        </Link>

        <SidebarCollapsibleSection
          storageKey="adehq.sidebar.rooms"
          label="Rooms"
          href="/rooms"
          count={rooms.length}
          isSectionActive={pathname === "/rooms" || !!onGroupRoom}
          forceOpen={!!onGroupRoom}
          headerAction={
            <button
              type="button"
              onClick={ui.openCreateRoom}
              title="Create room"
              className="flex h-[14px] w-[14px] shrink-0 items-center justify-center text-[var(--rail-icon)] transition-colors hover:text-[var(--rail-ink)]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          }
        >
          {rooms.length === 0 ? (
            <p className="px-2 py-1.5 pl-[27px] text-[11px] leading-relaxed text-[var(--rail-ink-3)]">No rooms yet</p>
          ) : (
            rooms.slice(0, MAX_SIDEBAR_ITEMS).map((room) => (
              <SidebarNestedLink
                key={room.id}
                href={`/rooms/${room.id}`}
                active={activeRoomId === room.id}
                label={room.name}
                badge={unreadBadge(room.unread)}
              />
            ))
          )}
          {rooms.length > MAX_SIDEBAR_ITEMS && (
            <SidebarNestedLink
              href="/rooms"
              label={`+${rooms.length - MAX_SIDEBAR_ITEMS} more`}
            />
          )}
        </SidebarCollapsibleSection>

        <SidebarCollapsibleSection
          storageKey="adehq.sidebar.dms"
          label="Direct messages"
          href="/dm"
          count={dmUnreadTotal > 0 ? dmUnreadTotal : sidebarDmCount}
          countVariant={dmUnreadTotal > 0 || hasDmUnread ? "pill" : "muted"}
          isSectionActive={pathname === "/dm" || !!onDmRoom}
          forceOpen={!!onDmRoom}
        >
          {sidebarDmCount === 0 ? (
            <p className="px-2 py-1.5 pl-[27px] text-[11px] leading-relaxed text-[var(--rail-ink-3)]">
              {showMaya
                ? "Maya will appear here once your workspace loads"
                : "Message teammates and AI employees here"}
            </p>
          ) : (
            <>
              {humanPeers.slice(0, Math.min(6, MAX_SIDEBAR_ITEMS)).map((peer) => {
                const dm = state.rooms.find(
                  (r) =>
                    r.kind === "dm" &&
                    !r.dmEmployeeId &&
                    (r.dmPeerUserId === peer.userId || r.dmOwnerUserId === peer.userId),
                );
                const active = dm ? activeRoomId === dm.id : false;
                const accent = avatarAccentForId(peer.userId);
                return (
                  <SidebarNestedButton
                    key={`human-${peer.userId}`}
                    onClick={() => openHumanDM(peer.userId)}
                    active={active}
                    icon={
                      <HumanAvatar
                        name={peer.name ?? peer.email ?? "Member"}
                        size="xs"
                        userId={peer.userId}
                        src={peer.avatar}
                        accent={accent.background}
                      />
                    }
                    label={peer.name ?? peer.email ?? "Member"}
                    badge={dm ? unreadBadge(dm.unread) : undefined}
                  />
                );
              })}
              {sidebarDmEmployees
                .slice(0, Math.max(0, MAX_SIDEBAR_ITEMS - Math.min(6, humanPeers.length)))
                .map((employee) => {
                  const dm = findDmRoomForEmployee(state.rooms, employee.id, state.user?.id);
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
                          <span className="max-w-[7.5rem] truncate rounded border border-[var(--rail-edge)] bg-[var(--rail-badge-bg)] px-[5px] py-px font-mono text-[9px] tracking-[0.03em] text-[var(--rail-badge-ink)]">
                            {MAYA_WORKFORCE_BADGE}
                          </span>
                        ) : dm ? (
                          unreadBadge(dm.unread)
                        ) : undefined
                      }
                    />
                  );
                })}
            </>
          )}
          {sidebarDmCount > MAX_SIDEBAR_ITEMS && (
            <SidebarNestedLink
              href="/dm"
              label={`+${sidebarDmCount - MAX_SIDEBAR_ITEMS} more`}
            />
          )}
        </SidebarCollapsibleSection>

        <Link href="/calls" className={cn("nav-link mt-1", isActive("/calls") && "nav-link-active")}>
          <Phone className="h-4 w-4" strokeWidth={1.9} />
          <span className="flex-1 truncate">Calls</span>
          {!WORKFORCE_CALLS_ENABLED && (
            <span className="rounded-[5px] bg-amber-soft px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-amber">
              Soon
            </span>
          )}
        </Link>

        <p className="rail-section-label !pt-[18px]">Workforce</p>
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
              <item.icon className="h-4 w-4" strokeWidth={1.9} />
              <span className="flex-1 truncate">{item.label}</span>
              {badge > 0 && (
                <span className="rounded-full bg-[var(--rail-badge-bg)] px-1.5 py-px font-mono text-[10px] text-[var(--rail-badge-ink)]">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Fixed: hire + profile */}
      <div className="relative shrink-0">
        {workingCount > 0 && (
          <div className="mx-3 mb-1 flex min-w-0 items-center gap-1.5 rounded-[10px] border border-green/20 bg-green-soft px-2.5 py-1.5 text-[11px] font-medium text-green">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green animate-glowpulse" />
            <span className="min-w-0 truncate">{workingCount} working now</span>
          </div>
        )}

        {canHire && (
          <div className="px-3 pb-2.5 pt-2.5">
            <button
              type="button"
              onClick={ui.openHire}
              className="group flex w-full min-w-0 items-center gap-2.5 rounded-[10px] border border-[var(--rail-edge)] bg-[var(--rail-ink)] px-3 py-2.5 text-left text-white transition-colors hover:bg-[rgb(56_50_45)]"
            >
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-white/12">
                <UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-tight tracking-[-0.01em]">
                  Hire AI employee
                </span>
                <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[0.06em] text-[rgb(188_182_177)]">
                  Open role
                </span>
              </span>
            </button>
          </div>
        )}

        <div className="border-t border-[var(--rail-border)] px-3 py-2.5">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[10px] p-0.5 text-left transition-colors",
              profileOpen ? "bg-[var(--rail-hover)]" : "hover:bg-[var(--rail-hover)]",
            )}
            aria-expanded={profileOpen}
            aria-haspopup="menu"
          >
            <HumanAvatar
              name={state.user?.name ?? "You"}
              userId={state.user?.id}
              src={state.user?.avatar}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold tracking-[-0.01em] text-[var(--rail-ink)]">
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
                "h-[15px] w-[15px] shrink-0 text-[var(--rail-ink-3)] transition-transform duration-200",
                profileOpen && "rotate-180",
              )}
              strokeWidth={2.2}
            />
          </button>
        </div>

        <AnimatePresence>
          {profileOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setProfileOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-2 right-2 z-40 mb-2 overflow-hidden rounded-xl border border-border bg-surface shadow-lift"
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
