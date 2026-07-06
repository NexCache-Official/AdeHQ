"use client";

import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminPageHeader,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import { ToggleLeft } from "lucide-react";

type FlagRow = {
  id: string;
  key: string;
  value: unknown;
  flagType: string;
  scope: string;
  description: string | null;
  updatedAt: string;
};

type FlagsResponse = {
  flags: FlagRow[];
  runtimeEnvFlags: Record<string, unknown>;
};

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value || '""';
  return JSON.stringify(value);
}

export default function AdminFeatureFlagsPage() {
  const { data, loading, error } = useAdminData<FlagsResponse>("/api/admin/feature-flags");

  const columns: AdminColumn<FlagRow>[] = [
    { key: "key", header: "Flag", render: (f) => <span className="font-mono text-xs">{f.key}</span> },
    {
      key: "value",
      header: "DB value",
      render: (f) => (
        <AdminHealthBadge
          tone={f.value === true || f.value === "true" ? "healthy" : f.value === false || f.value === "false" ? "disabled" : "unknown"}
          label={formatValue(f.value)}
        />
      ),
    },
    { key: "type", header: "Type", render: (f) => f.flagType },
    { key: "scope", header: "Scope", render: (f) => f.scope },
    {
      key: "desc",
      header: "Description",
      render: (f) => <span className="text-xs text-ink-3">{f.description ?? "—"}</span>,
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Feature Flags"
        subtitle="Platform flags (DB overrides env). Read-only in Stage 1B — writes in Stage 2."
        icon={<ToggleLeft className="h-5 w-5" />}
      />

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <AdminDataTable
              columns={columns}
              rows={data.flags}
              rowKey={(f) => f.id}
              emptyLabel="No flags configured."
            />

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Runtime env flags (fallback)</h2>
              <div className="grid gap-2 md:grid-cols-2">
                {Object.entries(data.runtimeEnvFlags).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs text-ink-3">{key}</span>
                    <span className="text-ink-2">{formatValue(value)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
