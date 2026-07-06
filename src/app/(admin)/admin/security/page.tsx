"use client";

import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminMetricCard,
  AdminPageHeader,
  formatUsd,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { SecuritySummary } from "@/lib/admin/queries/security";
import { ShieldAlert } from "lucide-react";

export default function AdminSecurityPage() {
  const { data, loading, error } = useAdminData<SecuritySummary>("/api/admin/security");

  const costColumns: AdminColumn<SecuritySummary["highCostFreeWorkspaces"][number]>[] = [
    { key: "name", header: "Workspace", render: (r) => r.name },
    { key: "cost", header: "Cost (30d)", align: "right", render: (r) => formatUsd(r.costUsd30d) },
  ];

  const riskColumns: AdminColumn<SecuritySummary["recentRiskEvents"][number]>[] = [
    { key: "type", header: "Type", render: (r) => r.riskType },
    { key: "severity", header: "Severity", render: (r) => r.severity },
    { key: "desc", header: "Description", render: (r) => r.description },
    { key: "created", header: "Created", render: (r) => new Date(r.createdAt).toLocaleString() },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Security"
        subtitle="Abuse signals, high-cost workspaces, and risk events."
        icon={<ShieldAlert className="h-5 w-5" />}
      />

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <AdminMetricCard label="Disabled workspaces" value={data.disabledWorkspaces} />
              <AdminMetricCard label="High-severity audits (7d)" value={data.auditAnomalies} />
              <AdminMetricCard label="Open risk events" value={data.recentRiskEvents.length} />
            </div>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">High-cost free/founder workspaces (30d)</h2>
              <AdminDataTable
                columns={costColumns}
                rows={data.highCostFreeWorkspaces}
                rowKey={(r) => r.workspaceId}
                emptyLabel="No anomalies detected."
              />
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Recent risk events</h2>
              <AdminDataTable
                columns={riskColumns}
                rows={data.recentRiskEvents}
                rowKey={(r) => r.id}
                emptyLabel="No open risk events."
              />
            </Card>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
