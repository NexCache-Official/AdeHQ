"use client";

import Link from "next/link";
import { useStore } from "@/lib/demo-store";
import { useWorkspaceUsage } from "@/hooks/useWorkspaceUsage";
import { cn } from "@/lib/utils";

/** Compact pooled Work Hours meter for the left rail (under workspace name). */
export function SidebarWorkHoursMeter() {
  const { state, backend } = useStore();
  const workspaceId = backend === "supabase" ? state.workspace?.id ?? null : null;
  const { data, loading } = useWorkspaceUsage(workspaceId);

  if (!workspaceId) return null;

  const cap = data?.capacity;
  const unlimited = cap?.unlimited ?? false;
  // Same period total as Settings → Usage (floored ledger rollup).
  const used = data?.totalWorkHours ?? cap?.used ?? 0;
  const allowance = cap?.allowance ?? 0;
  const pct = unlimited || allowance <= 0 ? 0 : Math.min(100, (used / allowance) * 100);
  const warn = cap?.warningLevel === "low" || cap?.warningLevel === "exhausted";

  return (
    <Link
      href="/settings/usage"
      className="mb-1 mt-1 block rounded-[11px] border border-[var(--rail-border)] bg-[var(--rail-fill)] px-2.5 py-2 transition-colors hover:bg-[var(--rail-hover)]"
      title="Week resets Mon 00:00 UTC · also resets at month end"
    >
      <div className="flex items-center justify-between gap-2 text-[10.5px] text-[var(--rail-ink-2)]">
        <span className="font-medium text-[var(--rail-ink)]">AI Work Hours</span>
        <span className="tabular-nums text-[var(--rail-ink-3)]">
          {loading
            ? "…"
            : unlimited
              ? "Unlimited"
              : `${used.toFixed(2)} / ${allowance.toFixed(2)}`}
        </span>
      </div>
      {!unlimited && (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--rail-border)]">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                warn ? "bg-amber-500" : "bg-emerald-500",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--rail-ink-3)]">
            {loading ? "—" : `${Math.round(pct)}%`}
          </span>
        </div>
      )}
    </Link>
  );
}
