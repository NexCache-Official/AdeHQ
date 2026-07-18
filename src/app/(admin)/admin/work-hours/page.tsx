"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminHealthBadge,
  AdminMetricCard,
  AdminPageHeader,
  formatCount,
  formatUsd,
  useAdminData,
} from "@/components/admin/common";
import type { WorkHoursSummary } from "@/lib/admin/queries/work-hours";
import { Clock } from "lucide-react";

const RANGES = ["7d", "30d", "90d"] as const;

function MinutesList({
  title,
  entries,
}: {
  title: string;
  entries: { key: string; label?: string; minutes: number }[];
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-3">No entries in range.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.key} className="flex items-center justify-between text-sm">
              <span className="truncate text-ink-2">{entry.label ?? entry.key}</span>
              <span className="ml-3 shrink-0 tabular-nums text-ink">
                {entry.minutes.toFixed(2)}m
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function HoursList({
  title,
  entries,
}: {
  title: string;
  entries: { key: string; label?: string; workHours: number }[];
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-3">No commercial hours in this range.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.key} className="flex items-center justify-between text-sm">
              <span className="truncate text-ink-2">{entry.label ?? entry.key}</span>
              <span className="ml-3 shrink-0 tabular-nums text-ink">
                {entry.workHours.toFixed(2)} hrs
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function AdminWorkHoursPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30d");
  const { data, loading, error } = useAdminData<WorkHoursSummary>(
    `/api/admin/work-hours?range=${range}`,
  );

  const commercial = data?.commercial ?? data?.currentPeriod;
  const shadow = data?.shadow;
  const clock = data?.usageClock;

  return (
    <div>
      <AdminPageHeader
        title="Work Hours"
        subtitle="Commercial AI Work Hours use a per-workspace 168-hour usage clock (activation-anchored). Independent of billing anniversary — not Monday UTC."
        icon={<Clock className="h-5 w-5" />}
        actions={
          <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  range === r ? "bg-accent-soft text-accent-d" : "text-ink-3 hover:text-ink"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        }
      />

      <AdminAsync loading={loading} error={error}>
        {data && commercial && (
          <div className="space-y-6">
            {clock ? (
              <Card className="p-5">
                <h2 className="mb-1 text-sm font-semibold text-ink">Usage clock</h2>
                <p className="mb-4 text-xs text-ink-3">{clock.description}</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <AdminMetricCard
                    label="Commerce anchors"
                    value={formatCount(clock.workspacesWithAnchor)}
                    hint="workspaces with usage_anchor_at"
                  />
                  <AdminMetricCard
                    label="Legacy fallback"
                    value={formatCount(clock.workspacesLegacyFallback)}
                    hint="no anchor yet (legacy weekly fallback)"
                  />
                  <AdminMetricCard
                    label="Open periods"
                    value={formatCount(clock.openPeriods)}
                    hint="active workspace_usage_periods"
                  />
                  <AdminMetricCard
                    label="Paid / Free clocks"
                    value={`${clock.byClockKind.paid} / ${clock.byClockKind.free}`}
                    hint={`${clock.byClockKind.unknown} unknown`}
                  />
                </div>
              </Card>
            ) : null}

            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-ink">
                Commercial Work Hours ({range})
              </h2>
              <p className="mb-3 text-xs text-ink-3">
                Billable WH charged from the cost ledger in the selected range. Each workspace’s
                allowance still resets on its own 168h boundary.
              </p>
              <p className="text-2xl font-semibold tabular-nums text-ink">
                {(
                  "totalWorkHours" in commercial
                    ? commercial.totalWorkHours
                    : 0
                ).toFixed(2)}{" "}
                AI Work Hours
              </p>
              {data.commercial ? (
                <p className="mt-1 text-xs text-ink-3">
                  Maya / hiring exempt: {data.commercial.mayaExemptWorkHours.toFixed(2)} hrs ·{" "}
                  {formatCount(data.commercial.entryCount)} billable ledger rows
                </p>
              ) : null}
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <HoursList
                  title="By workspace"
                  entries={
                    "byWorkspace" in commercial ? commercial.byWorkspace : []
                  }
                />
                <HoursList
                  title="By employee"
                  entries={"byEmployee" in commercial ? commercial.byEmployee : []}
                />
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink">Shadow metering</h2>
                  <p className="mt-1 max-w-2xl text-xs text-ink-3">
                    Measurement-only estimated minutes derived from AI cost (for calibration). This
                    is <span className="font-medium text-ink-2">not</span> what customers are billed
                    — commercial WH comes from the cost ledger above. Safe to ignore for ops if
                    rows are empty.
                  </p>
                </div>
                <AdminHealthBadge
                  tone={(shadow?.enabled ?? data.shadowEnabled) ? "healthy" : "disabled"}
                  label={(shadow?.enabled ?? data.shadowEnabled) ? "Enabled" : "Off"}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
                <AdminMetricCard
                  label="Shadow Work Hours"
                  value={(shadow?.workHours ?? data.totals?.workHours ?? 0).toFixed(2)}
                  hint={`${(shadow?.workMinutes ?? data.totals?.workMinutes ?? 0).toFixed(2)} minutes`}
                />
                <AdminMetricCard
                  label="Shadow cost"
                  value={formatUsd(shadow?.costUsd ?? data.totals?.costUsd)}
                />
                <AdminMetricCard
                  label="Ledger entries"
                  value={formatCount(shadow?.entryCount ?? data.totals?.entryCount)}
                />
                <AdminMetricCard
                  label="Configured $/min"
                  value={`$${(shadow?.configuredUsdPerMinute ?? data.configuredUsdPerMinute ?? 0).toFixed(4)}`}
                />
                <AdminMetricCard
                  label="Implied $/min"
                  value={
                    (shadow?.impliedUsdPerMinute ?? data.impliedUsdPerMinute) != null
                      ? `$${(shadow?.impliedUsdPerMinute ?? data.impliedUsdPerMinute)!.toFixed(4)}`
                      : "—"
                  }
                  hint="from actual costs"
                />
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <MinutesList
                title="Shadow by workspace"
                entries={shadow?.byWorkspace ?? data.byWorkspace ?? []}
              />
              <MinutesList
                title="Shadow by work type"
                entries={shadow?.byWorkType ?? data.byWorkType ?? []}
              />
              <MinutesList
                title="Shadow by plan"
                entries={shadow?.byPlan ?? data.byPlan ?? []}
              />
              <MinutesList
                title="Shadow by employee"
                entries={shadow?.byEmployee ?? data.byEmployee ?? []}
              />
            </div>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
