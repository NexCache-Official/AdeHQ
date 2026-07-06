"use client";

import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminMetricCard,
  AdminPageHeader,
  formatBytes,
  formatCount,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { FilesStorageSummary } from "@/lib/admin/queries/files-storage";
import { HardDrive } from "lucide-react";

export default function AdminFilesStoragePage() {
  const { data, loading, error } = useAdminData<FilesStorageSummary>("/api/admin/files-storage");

  const wsColumns: AdminColumn<FilesStorageSummary["byWorkspace"][number]>[] = [
    { key: "name", header: "Workspace", render: (r) => r.name },
    { key: "used", header: "Used", align: "right", render: (r) => formatBytes(r.usedBytes) },
  ];

  const typeColumns: AdminColumn<FilesStorageSummary["fileTypeBreakdown"][number]>[] = [
    { key: "type", header: "Type", render: (r) => r.type },
    { key: "count", header: "Count", align: "right", render: (r) => formatCount(r.count) },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Files & Storage"
        subtitle="Drive usage, artifacts, and upload activity."
        icon={<HardDrive className="h-5 w-5" />}
      />

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <AdminMetricCard label="Total storage used" value={formatBytes(data.totalUsedBytes)} />
              <AdminMetricCard label="Artifacts" value={formatCount(data.totalArtifacts)} />
              <AdminMetricCard label="Uploads (7d)" value={formatCount(data.uploads7d)} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Top workspaces by storage</h2>
                <AdminDataTable
                  columns={wsColumns}
                  rows={data.byWorkspace}
                  rowKey={(r) => r.workspaceId}
                  emptyLabel="No quota data."
                />
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">File type breakdown</h2>
                <AdminDataTable
                  columns={typeColumns}
                  rows={data.fileTypeBreakdown}
                  rowKey={(r) => r.type}
                  emptyLabel="No files recorded."
                />
              </Card>
            </div>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
