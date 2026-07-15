"use client";

import { useStore } from "@/lib/demo-store";
import { useWorkspaceUsage, type UsageBreakdownRow } from "@/hooks/useWorkspaceUsage";
import { PageHeader } from "@/components/Page";
import { Card } from "@/components/ui";
import { Gauge } from "lucide-react";

function sumHours(rows: UsageBreakdownRow[]): number {
  return Math.round(rows.reduce((sum, row) => sum + row.workHours, 0) * 100) / 100;
}

function BreakdownCard({
  title,
  rows,
  totalLabel,
}: {
  title: string;
  rows: UsageBreakdownRow[];
  totalLabel: string;
}) {
  const total = sumHours(rows);
  return (
    <Card className="p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
          {total.toFixed(2)} hrs
        </p>
      </div>
      <p className="mb-3 text-[11px] text-ink-3">{totalLabel}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">No AI activity yet this period.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between rounded-lg border border-border-2 bg-muted/40 px-3 py-2"
            >
              <span className="truncate text-sm text-ink-2">{row.label}</span>
              <span className="ml-3 shrink-0 text-sm font-medium tabular-nums text-ink">
                {row.workHours.toFixed(2)} hrs
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-border-2 pt-2">
            <span className="text-sm font-medium text-ink">Total</span>
            <span className="text-sm font-semibold tabular-nums text-ink">
              {total.toFixed(2)} hrs
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function SettingsUsagePage() {
  const { state } = useStore();
  const { data, loading, error } = useWorkspaceUsage(state.workspace.id);
  const periodTotal = data?.totalWorkHours ?? 0;

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="All billable AI Work Hours this period. Employee and work-type columns are two views of the same pool (not added together). Week resets Mon 00:00 UTC · also resets at month end."
        icon={<Gauge className="h-5 w-5" />}
      />

      {error && <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {loading ? (
        <Card className="p-6 text-sm text-ink-3">Loading…</Card>
      ) : (
        <>
          <Card className="mb-4 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              Total AI Work Hours this period
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {periodTotal.toFixed(2)} AI Work Hours
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {(data?.capacity.used ?? 0).toFixed(2)} of{" "}
              {data?.capacity.unlimited
                ? "unlimited"
                : `${(data?.capacity.allowance ?? 0).toFixed(2)}`}{" "}
              pooled workspace hours used
            </p>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <BreakdownCard
              title="By AI employee"
              rows={data?.byEmployee ?? []}
              totalLabel="Sum of hours attributed to each employee (same period total)."
            />
            <BreakdownCard
              title="By work type"
              rows={data?.byWorkType ?? []}
              totalLabel="Sum of hours by work type (same period total)."
            />
          </div>
        </>
      )}
    </>
  );
}
