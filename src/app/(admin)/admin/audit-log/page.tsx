"use client";

import {
  AdminAsync,
  AdminDataTable,
  AdminPageHeader,
  formatDate,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { AuditLogEntry } from "@/lib/admin/types";
import { ScrollText } from "lucide-react";

export default function AdminAuditLogPage() {
  const { data, loading, error } = useAdminData<{ entries: AuditLogEntry[] }>(
    "/api/admin/audit-log?limit=200",
  );

  const columns: AdminColumn<AuditLogEntry>[] = [
    { key: "when", header: "When", render: (e) => formatDate(e.createdAt) },
    { key: "admin", header: "Admin", render: (e) => e.adminEmail ?? e.adminUserId.slice(0, 8) },
    { key: "action", header: "Action", render: (e) => <span className="font-mono text-xs">{e.action}</span> },
    {
      key: "target",
      header: "Target",
      render: (e) =>
        e.targetType ? (
          <span className="text-xs text-ink-3">
            {e.targetType}:{e.targetId ?? "—"}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (e) => <span className="text-xs text-ink-3">{e.reason ?? "—"}</span>,
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Audit Log"
        subtitle="Every platform admin mutation and restricted view."
        icon={<ScrollText className="h-5 w-5" />}
      />

      <AdminAsync loading={loading} error={error}>
        <AdminDataTable
          columns={columns}
          rows={data?.entries ?? []}
          rowKey={(e) => e.id}
          emptyLabel="No audit entries yet."
        />
      </AdminAsync>
    </div>
  );
}
