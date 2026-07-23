"use client";

import Link from "next/link";
import { useStore } from "@/lib/demo-store";
import { useWorkspaceUsage } from "@/hooks/useWorkspaceUsage";

/** Compact pooled Work Hours meter for the left rail (under workspace name). */
export function SidebarWorkHoursMeter() {
  const { state, backend } = useStore();
  const workspaceId = backend === "supabase" ? state.workspace?.id ?? null : null;
  const { data, loading } = useWorkspaceUsage(workspaceId);

  // Demo mode has no usage API — still render the meter so the rail matches Home.dc.html.
  const isDemo = backend !== "supabase" || !workspaceId;
  const cap = data?.capacity;
  const unlimited = isDemo ? false : (cap?.unlimited ?? false);
  const used = isDemo ? 0.41 : (data?.totalWorkHours ?? cap?.used ?? 0);
  const allowance = isDemo ? 125 : (cap?.allowance ?? 0);
  const pct = unlimited || allowance <= 0 ? 0 : Math.min(100, (used / allowance) * 100);
  const warn = !isDemo && (cap?.warningLevel === "low" || cap?.warningLevel === "exhausted");
  const href = isDemo ? "/settings" : "/settings/usage";

  return (
    <Link
      href={href}
      className="block rounded-[10px] border border-[var(--rail-border)] bg-[var(--rail-fill)] px-[11px] py-[9px] transition-colors hover:bg-[var(--rail-hover)]"
      title="Hired AI employees only · Maya is free · rolling 7-day usage clock"
    >
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[10.5px] tracking-[0.08em] text-[var(--rail-badge-ink)]">
          AI WORK HOURS
        </span>
        <span className="min-w-0 shrink truncate text-right font-mono text-[11px] font-medium tabular-nums text-[var(--rail-ink)]">
          {isDemo
            ? `${used.toFixed(2)} / ${allowance.toFixed(2)}`
            : loading
              ? "…"
              : unlimited
                ? "Unlimited"
                : `${used.toFixed(2)} / ${allowance.toFixed(2)}`}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1 overflow-hidden rounded-[3px] bg-[var(--rail-border)]">
          <div
            className="h-full rounded-[3px] transition-all"
            style={{
              width: `${Math.max(pct, pct > 0 ? 1 : 0)}%`,
              background: warn ? "rgb(var(--c-amber))" : "var(--rail-ink)",
            }}
          />
        </div>
      )}
    </Link>
  );
}
