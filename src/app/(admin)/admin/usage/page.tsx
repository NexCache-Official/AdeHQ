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
import type { UsageSummary, UsageGroupBy } from "@/lib/admin/queries/usage";
import { BarChart3 } from "lucide-react";

const RANGES = ["1d", "7d", "30d", "90d"] as const;
const GROUPS: { id: UsageGroupBy; label: string }[] = [
  { id: "provider", label: "Provider" },
  { id: "model", label: "Model" },
  { id: "workspace", label: "Workspace" },
  { id: "employee", label: "Employee" },
  { id: "work_type", label: "Work type" },
  { id: "plan", label: "Plan" },
  { id: "day", label: "Day" },
];

export default function AdminUsagePage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("7d");
  const [groupBy, setGroupBy] = useState<UsageGroupBy>("provider");
  const { data, loading, error } = useAdminData<UsageSummary>(
    `/api/admin/usage?range=${range}&groupBy=${groupBy}`,
  );

  const breakdownColumns: AdminColumn<UsageSummary["breakdown"][number]>[] = [
    { key: "label", header: GROUPS.find((g) => g.id === groupBy)?.label ?? "Key", render: (r) => r.label },
    { key: "count", header: "Events", align: "right", render: (r) => formatCount(r.count) },
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

  return (
    <div>
      <AdminPageHeader
        title="Usage & Cost"
        subtitle="AI spend, tokens, failures, and Work Minutes across the platform."
        icon={<BarChart3 className="h-5 w-5" />}
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
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <AdminMetricCard label="Total cost" value={formatUsd(data.totals.costUsd)} />
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
                emptyLabel="No usage in this range."
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
