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
        <p className="text-sm text-ink-3">No commercial hours this period.</p>
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

  return (
    <div>
      <AdminPageHeader
        title="Work Hours"
        subtitle="Commercial AI Work Hours (Mon 00:00 UTC week, month-clipped) plus legacy shadow minutes."
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
        {data && (
          <div className="space-y-6">
            <Card className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-ink">Current commercial period</h2>
              <p className="mb-3 text-xs text-ink-3">
                {data.currentPeriod.startIso} → {data.currentPeriod.endExclusiveIso} (Mon 00:00 UTC
                week · month-end hard reset)
              </p>
              <p className="text-2xl font-semibold tabular-nums text-ink">
                {data.currentPeriod.totalWorkHours.toFixed(2)} AI Work Hours
              </p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <HoursList title="By workspace (period)" entries={data.currentPeriod.byWorkspace} />
                <HoursList title="By employee (period)" entries={data.currentPeriod.byEmployee} />
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <AdminMetricCard
                label="Shadow metering"
                value={
                  <AdminHealthBadge
                    tone={data.shadowEnabled ? "healthy" : "disabled"}
                    label={data.shadowEnabled ? "Enabled" : "Off"}
                  />
                }
              />
              <AdminMetricCard
                label="Shadow Work Hours"
                value={data.totals.workHours.toFixed(2)}
                hint={`${data.totals.workMinutes.toFixed(2)} minutes`}
              />
              <AdminMetricCard label="Cost" value={formatUsd(data.totals.costUsd)} />
              <AdminMetricCard label="Ledger entries" value={formatCount(data.totals.entryCount)} />
              <AdminMetricCard
                label="Configured $/min"
                value={`$${data.configuredUsdPerMinute.toFixed(4)}`}
              />
              <AdminMetricCard
                label="Implied $/min"
                value={
                  data.impliedUsdPerMinute != null
                    ? `$${data.impliedUsdPerMinute.toFixed(4)}`
                    : "—"
                }
                hint="from actual costs"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <MinutesList title="Shadow by workspace" entries={data.byWorkspace} />
              <MinutesList title="Shadow by work type" entries={data.byWorkType} />
              <MinutesList title="Shadow by plan" entries={data.byPlan} />
              <MinutesList title="Shadow by employee" entries={data.byEmployee} />
            </div>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
