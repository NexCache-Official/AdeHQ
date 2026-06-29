"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { useShellUI } from "./AppShell";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { Button, Kbd } from "./ui";
import { HumanAvatar } from "./EmployeeAvatar";
import { useDebugTrace } from "./DebugProvider";
import {
  Bug,
  ChevronDown,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  Settings,
  UserPlus,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function Topbar() {
  const { state, actions, backend } = useStore();
  const ui = useShellUI();
  const { enabled: debugEnabled, toggleEnabled } = useDebugTrace();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="z-20 flex h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
      {/* Left — workspace */}
      <div className="flex shrink-0 items-center">
        <WorkspaceSwitcher />
      </div>

      {/* Center — search */}
      <div className="hidden flex-1 justify-center md:flex">
        <button
          onClick={ui.openCommand}
          className="group flex h-9 w-full max-w-xl items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 transition-colors hover:border-accent-300 hover:bg-white hover:text-slate-700"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search or run a command…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      {/* Right — actions + profile */}
      <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
        <button
          type="button"
          onClick={toggleEnabled}
          className={cn(
            "hidden h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors sm:inline-flex",
            debugEnabled
              ? "border-amber-500/50 bg-amber-500/15 text-amber-700"
              : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white",
          )}
          title="Toggle debug trace terminal"
        >
          <Bug className="h-3.5 w-3.5" />
          Debug
        </button>
        <Button variant="secondary" size="sm" onClick={ui.openHire} className="hidden sm:inline-flex">
          <UserPlus className="h-4 w-4" />
          Hire AI Employee
        </Button>
        <Button size="sm" onClick={ui.openCreateRoom}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create Channel</span>
          <span className="sm:hidden">Channel</span>
        </Button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl p-0.5 pr-1.5 transition-colors hover:bg-slate-100"
          >
            <HumanAvatar name={state.user?.name ?? "User"} size="sm" />
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
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
                  className="absolute right-0 top-12 z-40 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel"
                >
                  <div className="border-b border-slate-200 p-3">
                    <div className="text-sm font-medium text-slate-900">{state.user?.name}</div>
                    <div className="truncate text-xs text-slate-500">{state.user?.email}</div>
                  </div>
                  <div className="p-1.5">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        router.push("/settings");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100"
                    >
                      <Settings className="h-4 w-4" /> Settings
                    </button>
                    {backend === "demo" && ENABLE_DEMO_MODE && (
                      <button
                        onClick={() => {
                          if (confirm("Reset all demo data? This restores the original demo workspace.")) {
                            actions.resetDemoData();
                            setMenuOpen(false);
                          }
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100"
                      >
                        <RotateCcw className="h-4 w-4" /> Reset demo data
                      </button>
                    )}
                    <button
                      onClick={() => {
                        actions.logout();
                        router.replace("/login");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-rose-600 transition-colors hover:bg-rose-500/10"
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
