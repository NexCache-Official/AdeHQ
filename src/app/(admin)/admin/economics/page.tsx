"use client";

import { useState } from "react";
import { Card, Button } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminMetricCard,
  AdminPageHeader,
  formatUsd,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import {
  AdminCostOverTimeChart,
  AdminHorizontalBars,
  AdminRevenueCogsChart,
} from "@/components/admin/AdminUsageCharts";
import type { EconomicsRange, EconomicsSummary } from "@/lib/admin/queries/economics";
import { Download, FileText, TrendingUp } from "lucide-react";

const RANGES: EconomicsRange[] = ["1d", "7d", "30d", "90d", "ytd"];

export default function AdminEconomicsPage() {
  const [range, setRange] = useState<EconomicsRange>("30d");
  const { data, loading, error } = useAdminData<EconomicsSummary>(
    `/api/admin/economics?range=${range}`,
  );

  const invoiceColumns: AdminColumn<EconomicsSummary["recentInvoices"][number]>[] = [
    {
      key: "when",
      header: "When",
      render: (r) => new Date(r.createdAt).toLocaleString(),
    },
    { key: "workspace", header: "Workspace", render: (r) => r.workspaceName },
    { key: "plan", header: "Plan", render: (r) => r.planSlug ?? "—" },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => formatUsd(r.amountUsd),
    },
  ];

  const cogsColumns: AdminColumn<EconomicsSummary["cogsByWorkspace"][number]>[] = [
    { key: "workspace", header: "Workspace", render: (r) => r.workspaceName },
    {
      key: "hired",
      header: "Hired",
      align: "right",
      render: (r) => formatUsd(r.hiredCogsUsd),
    },
    {
      key: "maya",
      header: "Maya",
      align: "right",
      render: (r) => formatUsd(r.mayaCogsUsd),
    },
    {
      key: "total",
      header: "Total COGS",
      align: "right",
      render: (r) => formatUsd(r.cogsUsd),
    },
  ];

  const planColumns: AdminColumn<EconomicsSummary["revenueByPlan"][number]>[] = [
    { key: "plan", header: "Plan", render: (r) => r.label },
    { key: "count", header: "Invoices", align: "right", render: (r) => r.count },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      render: (r) => formatUsd(r.revenueUsd),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Economics"
        subtitle="Revenue, AI COGS, and gross profit — statement export for any range."
        icon={<TrendingUp className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                window.open(`/api/admin/economics?range=${range}&format=csv`, "_blank");
              }}
            >
              <Download className="h-4 w-4" />
              CSV statement
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.open(`/api/admin/economics?range=${range}&format=html`, "_blank");
              }}
            >
              <FileText className="h-4 w-4" />
              Printable
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              range === r
                ? "bg-ink text-white"
                : "bg-muted text-ink-2 hover:bg-muted/80"
            }`}
          >
            {r.toUpperCase()}
          </button>
        ))}
      </div>

      <AdminAsync loading={loading} error={error}>
        {data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <AdminMetricCard label="Revenue" value={formatUsd(data.metrics.revenueUsd)} />
              <AdminMetricCard label="Platform COGS" value={formatUsd(data.metrics.cogsUsd)} />
              <AdminMetricCard
                label="Gross profit"
                value={formatUsd(data.metrics.grossProfitUsd)}
              />
              <AdminMetricCard
                label="Gross margin"
                value={`${data.metrics.grossMarginPct}%`}
              />
              <AdminMetricCard label="MRR" value={formatUsd(data.metrics.mrrUsd)} />
              <AdminMetricCard
                label="Paying workspaces"
                value={String(data.metrics.payingWorkspaces)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <AdminMetricCard label="ARR" value={formatUsd(data.metrics.arrUsd)} />
              <AdminMetricCard
                label="Hired COGS"
                value={formatUsd(data.metrics.hiredCogsUsd)}
              />
              <AdminMetricCard
                label="Maya COGS"
                value={formatUsd(data.metrics.mayaCogsUsd)}
              />
              <AdminMetricCard
                label="Paid invoices"
                value={String(data.metrics.paidInvoiceCount)}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-3 text-sm font-semibold text-ink">Revenue vs COGS</h2>
                <AdminRevenueCogsChart series={data.daySeries} />
              </Card>
              <Card className="p-4">
                <h2 className="mb-3 text-sm font-semibold text-ink">COGS · Hired vs Maya</h2>
                <AdminCostOverTimeChart
                  series={data.daySeries.map((d) => ({
                    day: d.day,
                    costUsd: d.cogsUsd,
                    mayaCostUsd: d.mayaCogsUsd,
                    hiredCostUsd: d.hiredCogsUsd,
                    eventCount: 0,
                  }))}
                />
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4">
                <h2 className="mb-3 text-sm font-semibold text-ink">Revenue by plan</h2>
                <AdminHorizontalBars
                  rows={data.revenueByPlan.map((r) => ({
                    key: r.planSlug,
                    label: r.label,
                    value: r.revenueUsd,
                  }))}
                />
                <div className="mt-4">
                  <AdminDataTable
                    columns={planColumns}
                    rows={data.revenueByPlan}
                    rowKey={(r) => r.planSlug}
                  />
                </div>
              </Card>
              <Card className="p-4">
                <h2 className="mb-3 text-sm font-semibold text-ink">Top COGS workspaces</h2>
                <AdminDataTable
                  columns={cogsColumns}
                  rows={data.cogsByWorkspace}
                  rowKey={(r) => r.workspaceId}
                />
              </Card>
            </div>

            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Recent paid invoices</h2>
              <AdminDataTable
                columns={invoiceColumns}
                rows={data.recentInvoices}
                rowKey={(r) => r.id}
              />
            </Card>
          </>
        ) : null}
      </AdminAsync>
    </div>
  );
}
