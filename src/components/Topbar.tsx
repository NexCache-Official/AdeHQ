"use client";

import { usePathname } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { useShellUI } from "./AppShell";
import { Button, Kbd } from "./ui";
import { useDebugTrace } from "./DebugProvider";
import { Bug, Plus, Search, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { canManageAiEmployees } from "@/lib/workspace/permissions";

function useBreadcrumb(pathname: string, roomName?: string, isDm?: boolean): string {
  if (pathname === "/") return "Home";
  if (pathname === "/rooms") return "Rooms";
  if (pathname === "/dm") return "Direct messages";
  if (pathname.startsWith("/rooms/")) {
    if (isDm) return roomName ? roomName : "Direct message";
    return roomName ? roomName : "Room";
  }
  if (pathname.startsWith("/workforce/")) return "Employee profile";
  if (pathname === "/workforce") return "Workforce";
  if (pathname === "/tasks") return "Tasks";
  if (pathname === "/memory") return "Memory";
  if (pathname === "/approvals") return "Approvals";
  if (pathname === "/work-log") return "Work Log";
  if (pathname === "/tools") return "Tools";
  if (pathname === "/calls") return "Calls";
  if (pathname === "/settings") return "Settings";
  return "AdeHQ";
}

export function Topbar() {
  const { state } = useStore();
  const ui = useShellUI();
  const { enabled: debugEnabled, toggleEnabled } = useDebugTrace();
  const pathname = usePathname();

  const roomId = pathname.match(/^\/rooms\/([^/]+)/)?.[1];
  const room = roomId ? state.rooms.find((r) => r.id === roomId) : undefined;
  const crumb = useBreadcrumb(pathname, room?.name, room?.kind === "dm");
  const workingCount = state.employees.filter((e) => e.status === "working").length;
  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role;
  const canHire = canManageAiEmployees(myRole);

  return (
    <header className="z-20 flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-canvas px-[22px]">
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <span className="truncate text-[15px] font-semibold tracking-tight text-ink">{crumb}</span>
        {workingCount > 0 && (
          <span className="hidden items-center gap-1.5 rounded-full bg-green-soft px-2.5 py-1 text-[11.5px] font-semibold text-green sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-green animate-glowpulse" />
            {workingCount} working
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={ui.openCommand}
        className="group hidden h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[13px] border border-border bg-surface px-3.5 text-[13px] text-ink-3 transition-all hover:border-[var(--accent)]/30 hover:shadow-sm md:flex"
      >
        <Search className="h-[15px] w-[15px] shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          Search messages, jump to a room, or run a command…
        </span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={toggleEnabled}
          className={cn(
            "hidden h-8 items-center gap-1.5 rounded-[11px] border px-2.5 text-xs font-medium transition-colors sm:inline-flex",
            debugEnabled
              ? "border-amber/40 bg-amber-soft text-amber"
              : "border-border bg-surface text-ink-2 hover:bg-muted",
          )}
          title="Toggle debug trace terminal"
        >
          <Bug className="h-3.5 w-3.5" />
          Debug
        </button>
        <Button
          variant="outline"
          size="sm"
          onClick={ui.openCreateRoom}
          className="hidden sm:inline-flex"
        >
          <Plus className="h-4 w-4" />
          Create room
        </Button>
        {canHire && (
          <Button size="sm" onClick={ui.openHire} className="shadow-glow">
            <UserPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Hire AI Employee</span>
            <span className="sm:hidden">Hire</span>
          </Button>
        )}
      </div>
    </header>
  );
}
