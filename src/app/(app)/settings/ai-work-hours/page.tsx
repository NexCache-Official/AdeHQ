"use client";

import Link from "next/link";
import { useStore } from "@/lib/demo-store";
import { useWorkspaceUsage } from "@/hooks/useWorkspaceUsage";
import { canViewBilling } from "@/lib/workspace/permissions";
import { PageHeader } from "@/components/Page";
import { Card, Button, Progress } from "@/components/ui";
import { Timer } from "lucide-react";

function formatResetDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "next Monday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function SettingsWorkHoursPage() {
  const { state } = useStore();
  const myRole = state.workspaceMembers.find((m) => m.userId === state.user?.id)?.role ?? "member";
  const { data, loading, error } = useWorkspaceUsage(state.workspace.id);

  const cap = data?.capacity;
  const allowance = cap?.allowance ?? 0;
  const used = cap?.used ?? 0;
  const remaining = cap?.remaining ?? 0;
  const unlimited = cap?.unlimited ?? false;
  const pct = unlimited || !allowance ? 0 : Math.min(100, (used / allowance) * 100);

  return (
    <>
      <PageHeader
        title="AI Work Hours"
        subtitle="Your weekly AI capacity. Human messaging is always unlimited."
        icon={<Timer className="h-5 w-5" />}
      />

      {error && <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <Card className="p-6">
        {loading ? (
          <p className="text-sm text-ink-3">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  This week
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
                  {unlimited ? "Unlimited" : `${remaining.toFixed(1)} left`}
                </p>
                {!unlimited && (
                  <p className="mt-0.5 text-sm text-ink-3">
                    {used.toFixed(1)} of {allowance.toFixed(0)} AI Work Hours used
                  </p>
                )}
              </div>
              <div className="text-right text-sm text-ink-3">
                <p className="capitalize">{cap?.planSlug ?? "free"} plan</p>
                <p>Resets {cap ? formatResetDate(cap.resetsAt) : "next Monday"}</p>
              </div>
            </div>

            {!unlimited && (
              <div className="mt-4">
                <Progress value={pct} />
              </div>
            )}

            {cap?.warningLevel === "exhausted" && !unlimited && (
              <div className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                Your AI employees are paused because this workspace has used its weekly AI Work Hours.
                Human messaging still works. They resume next week{canViewBilling(myRole) ? ", or you can upgrade for more capacity." : ". Ask a workspace admin to upgrade for more capacity."}
              </div>
            )}
            {cap?.warningLevel === "low" && !unlimited && (
              <div className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                Your workspace is running low on weekly AI Work Hours.
              </div>
            )}

            {canViewBilling(myRole) && (
              <div className="mt-5">
                <Link href="/settings/billing">
                  <Button size="sm">View plans & upgrade</Button>
                </Link>
              </div>
            )}
          </>
        )}
      </Card>

      <Card className="mt-4 p-6 text-sm text-ink-2">
        <h2 className="mb-2 text-sm font-semibold text-ink">What are AI Work Hours?</h2>
        <p>
          AI Work Hours are a simple way to measure AI workload across chat, search, browsing, files,
          and reports. Simple messages use very little. Advanced work like browser research,
          long-context analysis, coding, or large reports uses more.
        </p>
      </Card>
    </>
  );
}
