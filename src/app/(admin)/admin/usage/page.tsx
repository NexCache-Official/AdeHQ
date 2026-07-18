"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminMetricCard,
  AdminPageHeader,
  formatCount,
  formatUsd,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import {
  AdminCostOverTimeChart,
  AdminHorizontalBars,
} from "@/components/admin/AdminUsageCharts";
import type { UsageSummary, UsageGroupBy, UsageCohort } from "@/lib/admin/queries/usage";
import { BarChart3 } from "lucide-react";

const RANGES = ["1d", "7d", "30d", "90d"] as const;
const COHORTS: { id: UsageCohort; label: string }[] = [
  { id: "all", label: "All" },
  { id: "hired", label: "Hired only" },
  { id: "maya", label: "Maya only" },
];
const GROUPS: { id: UsageGroupBy; label: string }[] = [
  { id: "provider", label: "Provider" },
  { id: "model", label: "Model" },
  { id: "workspace", label: "Workspace" },
  { id: "employee", label: "Employee" },
  { id: "role", label: "Role" },
  { id: "work_type", label: "Work type" },
  { id: "plan", label: "Plan" },
  { id: "day", label: "Day" },
];

export default function AdminUsagePage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("7d");
  const [groupBy, setGroupBy] = useState<UsageGroupBy>("provider");
  const [cohort, setCohort] = useState<UsageCohort>("all");
  const { data, loading, error } = useAdminData<UsageSummary>(
    `/api/admin/usage?range=${range}&groupBy=${groupBy}&cohort=${cohort}`,
  );

  const breakdownColumns: AdminColumn<UsageSummary["breakdown"][number]>[] = [
    {
      key: "label",
      header: GROUPS.find((g) => g.id === groupBy)?.label ?? "Key",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{r.label}</div>
          {r.subtitle && (
            <div className="truncate text-[11px] text-ink-3" title={r.subtitle}>
              {r.subtitle}
            </div>
          )}
        </div>
      ),
    },
    { key: "count", header: "Events", align: "right", render: (r) => formatCount(r.count) },
    {
      key: "tokens",
      header: "Tokens in/out",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-ink-2">
          {formatCount(r.inputTokens)} / {formatCount(r.outputTokens)}
        </span>
      ),
    },
    {
      key: "fallback",
      header: "Fallback",
      align: "right",
      render: (r) => formatCount(r.fallbackCount),
    },
    {
      key: "failed",
      header: "Failed",
      align: "right",
      render: (r) => formatCount(r.failedCount),
    },
    { key: "cost", header: "Cost", align: "right", render: (r) => formatUsd(r.costUsd) },
  ];

  const failureColumns: AdminColumn<UsageSummary["failures"][number]>[] = [
    { key: "when", header: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
    { key: "workspace", header: "Workspace", render: (r) => r.workspaceName },
    { key: "provider", header: "Provider", render: (r) => r.provider },
    { key: "model", header: "Model", render: (r) => r.model },
    {
      key: "error",
      header: "Error",
      render: (r) => <span className="text-xs text-ink-3">{r.errorMessage ?? "—"}</span>,
    },
  ];

  const mayaWsColumns: AdminColumn<UsageSummary["maya"]["topWorkspaces"][number]>[] = [
    { key: "workspace", header: "Workspace", render: (r) => r.workspaceName },
    { key: "events", header: "Events", align: "right", render: (r) => formatCount(r.eventCount) },
    {
      key: "tokens",
      header: "Tokens in/out",
      align: "right",
      render: (r) => (
        <span className="tabular-nums">
          {formatCount(r.inputTokens)} / {formatCount(r.outputTokens)}
        </span>
      ),
    },
    { key: "cost", header: "Cost", align: "right", render: (r) => formatUsd(r.costUsd) },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Usage & Cost"
        subtitle="Platform COGS across hired employees and Maya (free for customers). Filter by cohort, role, and workspace."
        icon={<BarChart3 className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
              {COHORTS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCohort(c.id)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                    cohort === c.id ? "bg-accent-soft text-accent-d" : "text-ink-3 hover:text-ink"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
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
          </div>
        }
      />

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            {cohort === "all" ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <AdminMetricCard
                  label="Total (all)"
                  value={formatUsd(data.cohortTotals.allCostUsd)}
                  hint={`${formatCount(data.cohortTotals.allEvents)} events`}
                />
                <AdminMetricCard
                  label="Hired COGS"
                  value={formatUsd(data.cohortTotals.hiredCostUsd)}
                  hint={`${formatCount(data.cohortTotals.hiredEvents)} events · billable WH`}
                />
                <AdminMetricCard
                  label="Maya COGS"
                  value={formatUsd(data.cohortTotals.mayaCostUsd)}
                  hint={`${formatCount(data.cohortTotals.mayaEvents)} events · free for customers`}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <AdminMetricCard
                  label={cohort === "hired" ? "Hired COGS" : "Maya COGS"}
                  value={formatUsd(data.totals.costUsd)}
                  hint={
                    cohort === "hired"
                      ? `${formatCount(data.totals.eventCount)} events · billable WH`
                      : `${formatCount(data.totals.eventCount)} events · free for customers`
                  }
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <AdminMetricCard
                label={
                  cohort === "all"
                    ? "Filtered cost"
                    : cohort === "hired"
                      ? "Hired cost"
                      : "Maya cost"
                }
                value={formatUsd(data.totals.costUsd)}
              />
              <AdminMetricCard label="Events" value={formatCount(data.totals.eventCount)} />
              <AdminMetricCard
                label="Input tokens"
                value={formatCount(data.totals.inputTokens)}
              />
              <AdminMetricCard
                label="Output tokens"
                value={formatCount(data.totals.outputTokens)}
              />
              <AdminMetricCard
                label="Failed / blocked"
                value={formatCount(data.totals.failedCount + data.totals.blockedCount)}
                tone={data.totals.failedCount > 0 ? "warning" : "default"}
              />
              <AdminMetricCard
                label="Fallback rate"
                value={`${data.totals.fallbackRate}%`}
                tone={data.totals.fallbackRate > 20 ? "warning" : "default"}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="p-5 lg:col-span-3">
                <h2 className="mb-1 text-sm font-semibold text-ink">Cost over time</h2>
                <p className="mb-3 text-xs text-ink-3">
                  {cohort === "all"
                    ? "Stacked hired vs Maya platform spend for the selected range."
                    : cohort === "hired"
                      ? "Hired-employee platform spend only (Maya excluded)."
                      : "Maya platform spend only (hired employees excluded)."}
                </p>
                <AdminCostOverTimeChart series={data.daySeries} />
              </Card>
              <Card className="p-5 lg:col-span-2">
                <h2 className="mb-1 text-sm font-semibold text-ink">Top roles (this view)</h2>
                <p className="mb-3 text-xs text-ink-3">
                  Pooled by exact role title from the current breakdown when Role is selected;
                  otherwise shows top breakdown keys.
                </p>
                <AdminHorizontalBars
                  rows={(groupBy === "role" ? data.breakdown : data.breakdown.slice(0, 8)).map(
                    (r) => ({
                      key: r.key,
                      label: r.label,
                      value: r.costUsd,
                    }),
                  )}
                />
              </Card>
            </div>

            {(cohort === "all" || cohort === "maya") && (
              <Card className="p-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">Maya usage</h2>
                    <p className="text-xs text-ink-3">
                      Direct Chat {formatUsd(data.maya.directChatCostUsd)} · Hiring journey{" "}
                      {formatUsd(data.maya.hiringCostUsd)} ·{" "}
                      {formatCount(data.maya.inputTokens)} / {formatCount(data.maya.outputTokens)}{" "}
                      tokens
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {formatUsd(data.maya.costUsd)}
                  </p>
                </div>
                {data.maya.topWorkspaces.length === 0 ? (
                  <p className="text-sm text-ink-3">No Maya usage in this range.</p>
                ) : (
                  <AdminDataTable
                    columns={mayaWsColumns}
                    rows={data.maya.topWorkspaces}
                    rowKey={(r) => r.workspaceId}
                  />
                )}
              </Card>
            )}

            <div>
              <div className="mb-3 flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
                {GROUPS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setGroupBy(g.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      groupBy === g.id
                        ? "bg-accent-soft text-accent-d"
                        : "text-ink-3 hover:text-ink"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <AdminDataTable
                columns={breakdownColumns}
                rows={data.breakdown}
                rowKey={(r) => r.key}
                emptyLabel="No usage in this range for the selected cohort."
              />
            </div>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">
                Recent failures ({data.failures.length})
              </h2>
              {data.failures.length === 0 ? (
                <p className="text-sm text-ink-3">No failed or blocked events in range.</p>
              ) : (
                <AdminDataTable
                  columns={failureColumns}
                  rows={data.failures}
                  rowKey={(r) => `${r.createdAt}-${r.model}-${r.workspaceName}`}
                />
              )}
            </Card>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
