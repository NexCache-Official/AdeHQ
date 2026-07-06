"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminMetricCard,
  AdminPageHeader,
  formatCount,
  useAdminData,
} from "@/components/admin/common";
import type { GrowthSummary } from "@/lib/admin/queries/growth";
import { Rocket } from "lucide-react";

const RANGES = ["7d", "30d", "90d"] as const;

function hoursLabel(value: number | null): string {
  if (value == null) return "—";
  if (value < 1) return `${Math.round(value * 60)}m`;
  if (value < 48) return `${value.toFixed(1)}h`;
  return `${(value / 24).toFixed(1)}d`;
}

export default function AdminGrowthPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30d");
  const { data, loading, error } = useAdminData<GrowthSummary>(
    `/api/admin/growth?range=${range}`,
  );

  const maxFunnel = Math.max(1, ...(data?.funnel.map((f) => f.workspaces) ?? [1]));

  return (
    <div>
      <AdminPageHeader
        title="Growth"
        subtitle="Signups, activation funnel, and retention."
        icon={<Rocket className="h-5 w-5" />}
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
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <AdminMetricCard label="Signups today" value={formatCount(data.signups.today)} />
              <AdminMetricCard label="Signups (7d)" value={formatCount(data.signups.week)} />
              <AdminMetricCard label="Signups (30d)" value={formatCount(data.signups.month)} />
              <AdminMetricCard
                label="Onboarding completion"
                value={`${data.onboardingCompletionRate}%`}
              />
            </div>

            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink">
                Activation funnel ({range} workspace cohort)
              </h2>
              <div className="space-y-3">
                {data.funnel.map((step) => (
                  <div key={step.stage}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-ink-2">{step.stage}</span>
                      <span className="tabular-nums font-medium text-ink">
                        {formatCount(step.workspaces)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${(step.workspaces / maxFunnel) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <AdminMetricCard
                label="Time to first employee"
                value={hoursLabel(data.timeToFirst.employeeHours)}
                hint="median"
              />
              <AdminMetricCard
                label="Time to first AI reply"
                value={hoursLabel(data.timeToFirst.aiReplyHours)}
                hint="median"
              />
              <AdminMetricCard
                label="Time to first artifact"
                value={hoursLabel(data.timeToFirst.artifactHours)}
                hint="median"
              />
              <AdminMetricCard
                label="Time to first browser run"
                value={hoursLabel(data.timeToFirst.browserRunHours)}
                hint="median"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <AdminMetricCard
                label="D1 retention"
                value={data.retention.d1 != null ? `${data.retention.d1}%` : "—"}
              />
              <AdminMetricCard
                label="D7 retention"
                value={data.retention.d7 != null ? `${data.retention.d7}%` : "—"}
              />
              <AdminMetricCard
                label="D30 retention"
                value={data.retention.d30 != null ? `${data.retention.d30}%` : "—"}
              />
              <AdminMetricCard
                label="Employees / workspace"
                value={data.averages.employeesPerWorkspace}
              />
              <AdminMetricCard
                label="Rooms / workspace"
                value={data.averages.roomsPerWorkspace}
              />
            </div>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
