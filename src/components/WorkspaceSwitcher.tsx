"use client";

import { useState } from "react";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export function WorkspaceSwitcher({ onCreateWorkspace }: { onCreateWorkspace?: () => void }) {
  const { state, userWorkspaces, actions, backend } = useStore();
  const [open, setOpen] = useState(false);

  if (backend !== "supabase" || userWorkspaces.length <= 1) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="font-medium text-slate-700">{state.workspace.name}</span>
      </div>
    );
  }

  const pendingInvites = state.workspaceInvitations.filter(
    (i) => i.status === "pending" && i.workspaceId !== state.workspace.id,
  ).length;

  const current = userWorkspaces.find((w) => w.id === state.workspace.id);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm transition-colors hover:border-accent-300"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="max-w-[140px] truncate font-medium text-slate-700">{state.workspace.name}</span>
        {pendingInvites > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">
            {pendingInvites}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute left-0 top-11 z-40 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel"
            >
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Workspaces
              </div>
              <div className="max-h-64 overflow-y-auto p-1.5">
                {userWorkspaces.map((ws) => {
                  const active = ws.id === state.workspace.id;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        if (!active) void actions.switchWorkspace(ws.id);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                        active ? "bg-accent-50 text-accent-900" : "text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{ws.name}</div>
                        <div className="text-xs capitalize text-slate-500">
                          {ws.role}
                          {ENABLE_DEMO_MODE && ws.workspaceMode === "demo" ? " · demo" : ""}
                        </div>
                      </div>
                      {active && <Check className="h-4 w-4 shrink-0 text-accent-600" />}
                    </button>
                  );
                })}
              </div>
              {onCreateWorkspace && (
                <div className="border-t border-slate-100 p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onCreateWorkspace();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-4 w-4" /> Create workspace
                  </button>
                </div>
              )}
              {current && (
                <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
                  Active: {current.name}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
