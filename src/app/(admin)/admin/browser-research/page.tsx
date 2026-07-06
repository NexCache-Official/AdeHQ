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
import type { BrowserResearchSummary } from "@/lib/admin/queries/browser-research";
import { Globe } from "lucide-react";

const RANGES = ["1d", "7d", "30d"] as const;

export default function AdminBrowserResearchPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("7d");
  const { data, loading, error } = useAdminData<BrowserResearchSummary>(
    `/api/admin/browser-research?range=${range}`,
  );

  const failureColumns: AdminColumn<BrowserResearchSummary["recentFailures"][number]>[] = [
    { key: "when", header: "When", render: (r) => new Date(r.createdAt).toLocaleString() },
    { key: "workspace", header: "Workspace", render: (r) => r.workspaceName },
    { key: "provider", header: "Provider", render: (r) => r.provider },
    {
      key: "error",
      header: "Error",
      render: (r) => <span className="text-xs text-ink-3">{r.errorMessage ?? "—"}</span>,
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Browser Research"
        subtitle="Run metadata only — no screenshots or page content."
        icon={<Globe className="h-5 w-5" />}
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
              <AdminMetricCard label="Runs" value={formatCount(data.totals.runs)} />
              <AdminMetricCard label="Completed" value={formatCount(data.totals.completed)} />
              <AdminMetricCard
                label="Failed"
                value={formatCount(data.totals.failed)}
                tone={data.totals.failed > 0 ? "warning" : "default"}
              />
              <AdminMetricCard
                label="Avg duration"
                value={
                  data.totals.avgDurationSeconds != null
                    ? `${Math.round(data.totals.avgDurationSeconds)}s`
                    : "—"
                }
              />
              <AdminMetricCard label="Total cost" value={formatUsd(data.totals.totalCostUsd)} />
              <AdminMetricCard
                label="Avg cost / run"
                value={data.totals.avgCostUsd != null ? formatUsd(data.totals.avgCostUsd) : "—"}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">By provider</h2>
                {data.byProvider.length === 0 ? (
                  <p className="text-sm text-ink-3">No runs in range.</p>
                ) : (
                  <div className="space-y-2">
                    {data.byProvider.map((entry) => (
                      <div key={entry.key} className="flex items-center justify-between text-sm">
                        <span className="text-ink-2">{entry.key}</span>
                        <span className="tabular-nums text-ink">
                          {entry.runs} runs · {formatUsd(entry.costUsd)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Top workspaces</h2>
                {data.byWorkspace.length === 0 ? (
                  <p className="text-sm text-ink-3">No runs in range.</p>
                ) : (
                  <div className="space-y-2">
                    {data.byWorkspace.map((entry) => (
                      <div key={entry.key} className="flex items-center justify-between text-sm">
                        <span className="truncate text-ink-2">{entry.label}</span>
                        <span className="ml-3 shrink-0 tabular-nums text-ink">
                          {entry.runs} runs · {formatUsd(entry.costUsd)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">
                Recent failures ({data.recentFailures.length})
              </h2>
              {data.recentFailures.length === 0 ? (
                <p className="text-sm text-ink-3">No failed runs in range.</p>
              ) : (
                <AdminDataTable
                  columns={failureColumns}
                  rows={data.recentFailures}
                  rowKey={(r) => r.id}
                />
              )}
            </Card>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
