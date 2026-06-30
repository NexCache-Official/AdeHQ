"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { useShellUI } from "./AppShell";
import { Button, Kbd } from "./ui";
import { useDebugTrace } from "./DebugProvider";
import { Bug, LogOut, Plus, RotateCcw, Search, Settings, UserPlus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

function useBreadcrumb(pathname: string, roomName?: string, isDm?: boolean): string {
  if (pathname === "/") return "Home";
  if (pathname === "/rooms") return "Channels";
  if (pathname === "/dm") return "Direct messages";
  if (pathname.startsWith("/rooms/")) {
    if (isDm) return roomName ? roomName : "Direct message";
    return roomName ? roomName : "Channel";
  }
  if (pathname.startsWith("/workforce/")) return "Employee profile";
  if (pathname === "/workforce") return "AI Workforce";
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
  const { state, actions, backend } = useStore();
  const ui = useShellUI();
  const { enabled: debugEnabled, toggleEnabled } = useDebugTrace();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const roomId = pathname.match(/^\/rooms\/([^/]+)/)?.[1];
  const room = roomId ? state.rooms.find((r) => r.id === roomId) : undefined;
  const crumb = useBreadcrumb(pathname, room?.name, room?.kind === "dm");
  const workingCount = state.employees.filter((e) => e.status === "working").length;

  return (
    <header className="z-20 flex h-[60px] shrink-0 items-center gap-4 border-b border-border bg-canvas px-[22px]">
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        <span className="truncate text-[15px] font-semibold tracking-tight text-ink">{crumb}</span>
        {workingCount > 0 && (
          <span className="hidden items-center gap-1.5 rounded-full bg-green-soft px-2.5 py-1 text-[11.5px] font-semibold text-green sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-green animate-glowpulse" />
            {workingCount} working
          </span>
        )}
      </div>

      <div className="hidden flex-1 justify-center md:flex">
        <button
          onClick={ui.openCommand}
          className="group flex h-10 w-full max-w-[520px] items-center gap-2.5 rounded-[13px] border border-border bg-surface px-3.5 text-[13px] text-ink-3 transition-all hover:border-[var(--accent)]/30 hover:shadow-sm"
        >
          <Search className="h-[15px] w-[15px]" />
          <span className="flex-1 text-left">
            Search messages, jump to a room, or run a command…
          </span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <div className="ml-auto flex flex-1 items-center justify-end gap-2 md:flex-none">
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
          Create channel
        </Button>
        <Button size="sm" onClick={ui.openHire} className="shadow-glow">
          <UserPlus className="h-4 w-4" />
          <span className="hidden sm:inline">Hire AI Employee</span>
          <span className="sm:hidden">Hire</span>
        </Button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-border bg-surface text-xs font-bold text-ink transition-colors hover:bg-muted"
          >
            {(state.user?.name ?? "U").slice(0, 2).toUpperCase()}
          </button>

          <AnimatePresence>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-11 z-40 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-lift"
                >
                  <div className="border-b border-border-2 p-3">
                    <div className="text-sm font-medium text-ink">{state.user?.name}</div>
                    <div className="truncate text-xs text-ink-3">{state.user?.email}</div>
                  </div>
                  <div className="p-1.5">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        router.push("/settings");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-muted"
                    >
                      <Settings className="h-4 w-4" /> Settings
                    </button>
                    {backend === "demo" && ENABLE_DEMO_MODE && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              "Reset all demo data? This restores the original demo workspace.",
                            )
                          ) {
                            actions.resetDemoData();
                            setMenuOpen(false);
                          }
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-muted"
                      >
                        <RotateCcw className="h-4 w-4" /> Reset demo data
                      </button>
                    )}
                    <button
                      onClick={() => {
                        actions.logout();
                        router.replace("/login");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-danger transition-colors hover:bg-danger-soft"
                    >
                      <LogOut className="h-4 w-4" /> Log out
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
