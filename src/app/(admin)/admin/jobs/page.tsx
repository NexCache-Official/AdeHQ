"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminPageHeader,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { JobSummary } from "@/lib/admin/queries/jobs";
import { FileText } from "lucide-react";

export default function AdminJobsPage() {
  const { data, loading, error } = useAdminData<JobSummary>("/api/admin/jobs");

  const jobColumns: AdminColumn<JobSummary["recentJobs"][number]>[] = [
    { key: "type", header: "Job type", render: (r) => r.jobType },
    { key: "status", header: "Status", render: (r) => r.status },
    { key: "error", header: "Last error", render: (r) => r.lastError ?? "—" },
    { key: "created", header: "Created", render: (r) => new Date(r.createdAt).toLocaleString() },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Jobs"
        subtitle="Background jobs, queues, and sync runs."
        icon={<FileText className="h-5 w-5" />}
      />

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card className="p-4">
                <h3 className="text-sm font-semibold text-ink">Pricing sync</h3>
                <p className="mt-2 text-xs text-ink-3">
                  Running: {data.pricingSync.running} · Failed: {data.pricingSync.failed} · Done:{" "}
                  {data.pricingSync.completed}
                </p>
              </Card>
              <Card className="p-4">
                <h3 className="text-sm font-semibold text-ink">Agent runs</h3>
                <p className="mt-2 text-xs text-ink-3">
                  Queued: {data.agentRuns.queued} · Running: {data.agentRuns.running} · Failed:{" "}
                  {data.agentRuns.failed}
                </p>
              </Card>
              <Card className="p-4">
                <h3 className="text-sm font-semibold text-ink">Browser research</h3>
                <p className="mt-2 text-xs text-ink-3">
                  Running: {data.browserRuns.running} · Failed: {data.browserRuns.failed} · Done:{" "}
                  {data.browserRuns.completed}
                </p>
              </Card>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold text-ink">Recent job events</h2>
              <AdminDataTable
                columns={jobColumns}
                rows={data.recentJobs}
                rowKey={(r) => r.id}
                emptyLabel="No job events recorded."
              />
            </div>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
