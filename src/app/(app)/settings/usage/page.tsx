"use client";

import { useStore } from "@/lib/demo-store";
import { useWorkspaceUsage, type UsageBreakdownRow } from "@/hooks/useWorkspaceUsage";
import { PageHeader } from "@/components/Page";
import { Card } from "@/components/ui";
import { Gauge } from "lucide-react";

function BreakdownCard({ title, rows }: { title: string; rows: UsageBreakdownRow[] }) {
  return (
    <Card className="p-6">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
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
        </div>
      )}
    </Card>
  );
}

export default function SettingsUsagePage() {
  const { state } = useStore();
  const { data, loading, error } = useWorkspaceUsage(state.workspace.id);

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="Where your AI Work Hours went this period, by employee and work type. Week resets Mon 00:00 UTC · also resets at month end."
        icon={<Gauge className="h-5 w-5" />}
      />

      {error && <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {loading ? (
        <Card className="p-6 text-sm text-ink-3">Loading…</Card>
      ) : (
        <>
          <Card className="mb-4 p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              Total this period
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {(data?.totalWorkHours ?? 0).toFixed(2)} AI Work Hours
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
            <BreakdownCard title="By AI employee" rows={data?.byEmployee ?? []} />
            <BreakdownCard title="By work type" rows={data?.byWorkType ?? []} />
          </div>
        </>
      )}
    </>
  );
}
