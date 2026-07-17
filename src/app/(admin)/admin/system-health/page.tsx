"use client";

import { Card } from "@/components/ui";
import {
  AdminAsync,
  AdminHealthBadge,
  AdminMetricCard,
  AdminPageHeader,
  useAdminData,
} from "@/components/admin/common";
import type { SystemHealthSummary } from "@/lib/admin/queries/system-health";
import { Activity } from "lucide-react";

export default function AdminSystemHealthPage() {
  const { data, loading, error } = useAdminData<SystemHealthSummary>("/api/admin/system-health");

  return (
    <div>
      <AdminPageHeader
        title="System Health"
        subtitle="Platform health rollup — database, providers, jobs, incidents."
        icon={<Activity className="h-5 w-5" />}
      />

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <AdminMetricCard label="Open incidents" value={data.openIncidents} />
              <AdminMetricCard
                label="Database"
                value={<AdminHealthBadge tone={data.databaseOk ? "healthy" : "degraded"} label={data.databaseOk ? "OK" : "Error"} />}
              />
              <AdminMetricCard
                label="Agent runs queued"
                value={data.jobs.agentRuns.queued}
              />
              <AdminMetricCard
                label="Browser runs active"
                value={data.jobs.browserRuns.running}
              />
            </div>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Release baseline</h2>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <p className="text-xs text-ink-3">Commit</p>
                  <p className="font-mono text-ink">{data.buildInfo.gitCommit.slice(0, 12)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-3">Environment</p>
                  <p className="text-ink">{data.buildInfo.environment}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-3">Catalog</p>
                  <p className="text-ink">v{data.buildInfo.catalogVersion}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-3">Migration</p>
                  <p className="font-mono text-ink">{data.buildInfo.migrationVersion}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(data.buildInfo.enabledFeatures).map(([key, on]) => (
                  <span
                    key={key}
                    className={`rounded-md px-2 py-0.5 text-xs ${
                      on ? "bg-emerald-50 text-emerald-800" : "bg-surface-2 text-ink-3"
                    }`}
                  >
                    {key}:{on ? "on" : "off"}
                  </span>
                ))}
              </div>
              {data.buildInfo.mismatches.length > 0 && (
                <p className="mt-3 text-xs text-rose-700">
                  Mismatches: {data.buildInfo.mismatches.join("; ")}
                </p>
              )}
              <p className="mt-2 text-xs text-ink-3">
                Public probe: <span className="font-mono">/api/build-info</span>
              </p>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Provider health</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {data.providerHealth.map((p) => (
                  <div key={p.provider} className="rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">{p.provider}</span>
                      <AdminHealthBadge tone={p.status} />
                    </div>
                    <p className="mt-1 text-xs text-ink-3">
                      {p.enabledCount}/{p.endpointCount} endpoints · {p.successCount} ok · {p.failureCount} failed
                    </p>
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
