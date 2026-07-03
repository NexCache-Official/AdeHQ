"use client";

import { useState } from "react";
import { useStore } from "@/lib/demo-store";
import { ENABLE_DEMO_MODE } from "@/lib/config/features";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export function WorkspaceSwitcher({
  onCreateWorkspace,
  variant = "header",
}: {
  onCreateWorkspace?: () => void;
  variant?: "header" | "rail";
}) {
  const { state, userWorkspaces, actions, backend } = useStore();
  const [open, setOpen] = useState(false);

  const isRail = variant === "rail";
  const singleWorkspace = backend !== "supabase" || userWorkspaces.length <= 1;

  if (singleWorkspace && !isRail) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm">
        <span className="h-2 w-2 rounded-full bg-green animate-glowpulse" />
        <span className="font-medium text-ink">{state.workspace.name}</span>
      </div>
    );
  }

  if (singleWorkspace && isRail) {
    return (
      <div className="mb-2.5 flex items-center gap-2.5 rounded-[13px] border border-[var(--rail-border)] bg-[var(--rail-fill)] px-2.5 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-accent to-[var(--accent-2)] text-[15px] font-extrabold text-white shadow-[0_2px_8px_-2px_var(--accent-glow)]">
          {state.workspace.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-[var(--rail-ink)]">{state.workspace.name}</div>
          <div className="text-[11px] font-medium text-[var(--rail-ink-3)]">Operator workspace</div>
        </div>
      </div>
    );
  }

  const pendingInvites = state.workspaceInvitations.filter(
    (i) => i.status === "pending" && i.workspaceId !== state.workspace.id,
  ).length;

  const current = userWorkspaces.find((w) => w.id === state.workspace.id);

  return (
    <div className="relative mb-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-[13px] border text-left transition-colors",
          isRail
            ? "border-[var(--rail-border)] bg-[var(--rail-fill)] px-2.5 py-2 hover:bg-[var(--rail-hover)]"
            : "h-9 border-border bg-surface px-3 text-sm hover:border-accent/40",
        )}
      >
        {isRail ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-accent to-[var(--accent-2)] text-[15px] font-extrabold text-white">
            {state.workspace.name.slice(0, 1).toUpperCase()}
          </div>
        ) : (
          <span className="h-2 w-2 rounded-full bg-green" />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate font-semibold",
              isRail ? "text-[13.5px] text-[var(--rail-ink)]" : "text-ink",
            )}
          >
            {state.workspace.name}
          </div>
          {isRail && <div className="text-[11px] text-[var(--rail-ink-3)]">Operator workspace</div>}
        </div>
        {pendingInvites > 0 && (
          <span className="rounded-full bg-amber-soft px-1.5 text-[10px] font-medium text-amber">
            {pendingInvites}
          </span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0", isRail ? "text-[var(--rail-ink-2)]" : "text-ink-3")} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className={cn(
                "absolute z-40 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-lift",
                isRail ? "left-0 top-full mt-1" : "left-0 top-11",
              )}
            >
              <div className="border-b border-border-2 px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-3">
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
                        active ? "bg-accent-soft text-accent-d" : "text-ink hover:bg-muted",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{ws.name}</div>
                        <div className="text-xs capitalize text-ink-3">
                          {ws.role}
                          {ENABLE_DEMO_MODE && ws.workspaceMode === "demo" ? " · demo" : ""}
                        </div>
                      </div>
                      {active && <Check className="h-4 w-4 shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>
              {onCreateWorkspace && (
                <div className="border-t border-border-2 p-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onCreateWorkspace();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-2 hover:bg-muted"
                  >
                    <Plus className="h-4 w-4" /> Create workspace
                  </button>
                </div>
              )}
              {current && (
                <div className="border-t border-border-2 px-3 py-2 text-[11px] text-ink-3">
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
