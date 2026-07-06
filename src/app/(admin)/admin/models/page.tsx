"use client";

import { useMemo, useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button, Card } from "@/components/ui";
import {
  AdminAsync,
  AdminDataTable,
  AdminHealthBadge,
  AdminPageHeader,
  formatCount,
  useAdminData,
  type AdminColumn,
} from "@/components/admin/common";
import type { ModelsSummary, ModelCatalogRow } from "@/lib/admin/queries/models";
import { usePlatformAdmin } from "@/components/admin/AdminShell";
import { Activity } from "lucide-react";

export default function AdminModelsPage() {
  const admin = usePlatformAdmin();
  const { data, loading, error, refresh } = useAdminData<ModelsSummary>("/api/admin/models");
  const [filter, setFilter] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [smokeBusy, setSmokeBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const canWrite = admin.role === "super_admin" || admin.role === "ops_admin";

  const filteredCatalog = useMemo(() => {
    if (!data) return [];
    const term = filter.trim().toLowerCase();
    if (!term) return data.catalog;
    return data.catalog.filter((row) =>
      [row.endpointKey, row.providerRoute, row.modelId, row.displayName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [data, filter]);

  const toggleEndpoint = async (row: ModelCatalogRow, enabled: boolean) => {
    if (!row.endpointKey) return;
    const verb = enabled ? "Enable" : "Disable";
    if (!window.confirm(`${verb} endpoint ${row.endpointKey}? This is audited.`)) return;
    setBusyKey(row.endpointKey);
    setActionMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/models/endpoint", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ endpointKey: row.endpointKey, enabled }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Update failed.");
      await refresh();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusyKey(null);
    }
  };

  const runPricingSync = async () => {
    setSyncBusy(true);
    setActionMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/models/pricing/sync", {
        method: "POST",
        headers,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Sync failed.");
      setActionMsg(
        `Synced: +${body.totalAdded ?? 0} added / ${body.totalUpdated ?? 0} updated / ${body.totalDisabled ?? 0} disabled`,
      );
      await refresh();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncBusy(false);
    }
  };

  const runSmokeTest = async () => {
    setSmokeBusy(true);
    setActionMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/models/smoke-test", {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: "mock" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Smoke test failed.");
      const summary = (body.results as { provider: string; ok: boolean; latencyMs: number }[])
        .map((r) => `${r.provider}: ${r.ok ? "ok" : "fail"} (${r.latencyMs}ms)`)
        .join(" · ");
      setActionMsg(`Smoke test: ${summary}`);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Smoke test failed.");
    } finally {
      setSmokeBusy(false);
    }
  };

  const catalogColumns: AdminColumn<ModelCatalogRow>[] = [
    {
      key: "endpoint",
      header: "Endpoint",
      render: (r) => (
        <div>
          <p className="font-medium text-ink">{r.displayName ?? r.modelId}</p>
          <p className="font-mono text-[11px] text-ink-3">{r.endpointKey ?? `${r.providerRoute}/${r.modelId}`}</p>
        </div>
      ),
    },
    { key: "provider", header: "Provider", render: (r) => r.providerRoute },
    { key: "type", header: "Type", render: (r) => r.modelType },
    {
      key: "input",
      header: "In $/M",
      align: "right",
      render: (r) => (r.inputCostPerMillion != null ? `$${r.inputCostPerMillion}` : "—"),
    },
    {
      key: "output",
      header: "Out $/M",
      align: "right",
      render: (r) => (r.outputCostPerMillion != null ? `$${r.outputCostPerMillion}` : "—"),
    },
    { key: "source", header: "Source", render: (r) => <span className="text-xs">{r.source ?? "—"}</span> },
    {
      key: "enabled",
      header: "Status",
      render: (r) => (
        <AdminHealthBadge tone={r.enabled ? "healthy" : "disabled"} label={r.enabled ? "Enabled" : "Disabled"} />
      ),
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (r: ModelCatalogRow) => (
              <Button
                variant="outline"
                size="sm"
                disabled={!r.endpointKey || busyKey === r.endpointKey}
                onClick={() => void toggleEndpoint(r, !r.enabled)}
              >
                {r.enabled ? "Disable" : "Enable"}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <AdminPageHeader
        title="Models"
        subtitle="Model catalog, provider health, routing policy, and pricing sync."
        icon={<Activity className="h-5 w-5" />}
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={smokeBusy} onClick={() => void runSmokeTest()}>
                {smokeBusy ? "Testing…" : "Smoke test (mock)"}
              </Button>
              <Button variant="secondary" size="sm" disabled={syncBusy} onClick={() => void runPricingSync()}>
                {syncBusy ? "Refreshing…" : "Refresh model pricing"}
              </Button>
            </div>
          ) : undefined
        }
      />

      {actionMsg && <p className="mb-3 text-sm text-ink-2">{actionMsg}</p>}

      <AdminAsync loading={loading} error={error}>
        {data && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
              {data.providerHealth.map((provider) => (
                <Card key={provider.provider} className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">{provider.provider}</p>
                    <AdminHealthBadge tone={provider.status} />
                  </div>
                  <div className="space-y-1 text-xs text-ink-3">
                    <p>
                      {provider.enabledCount}/{provider.endpointCount} endpoints enabled
                    </p>
                    <p>
                      {formatCount(provider.successCount)} ok · {formatCount(provider.failureCount)} failed
                    </p>
                    {provider.avgLatencyMs != null && (
                      <p>
                        {provider.avgLatencyMs}ms avg
                        {provider.p95LatencyMs != null && ` · ${provider.p95LatencyMs}ms p95`}
                      </p>
                    )}
                    {!provider.configured && <p className="text-amber-600">API key not configured</p>}
                  </div>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Pinned provider policy</h2>
                <div className="space-y-2">
                  {Object.entries(data.pinnedPolicy).map(([mode, route]) => (
                    <div key={mode} className="flex items-center justify-between text-sm">
                      <span className="text-ink-2">{mode}</span>
                      <span className="font-mono text-xs text-ink-3">
                        {route.providerRoute} → {route.modelId}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-1 border-t border-border-2 pt-3 text-xs text-ink-3">
                  <p>Runtime V2 mode: <span className="font-medium text-ink-2">{data.runtimeFlags.mode}</span></p>
                  <p>Route optimizer: <span className="font-medium text-ink-2">{data.runtimeFlags.routeOptimizer}</span></p>
                  <p>Provider pref: <span className="font-medium text-ink-2">{data.runtimeFlags.providerPref}</span></p>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Recent pricing syncs</h2>
                {data.recentSyncRuns.length === 0 ? (
                  <p className="text-sm text-ink-3">No sync runs recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {data.recentSyncRuns.map((run) => (
                      <div key={run.id} className="flex items-center justify-between text-sm">
                        <span className="text-ink-2">
                          {run.provider}{" "}
                          <span
                            className={
                              run.status === "failed" ? "text-danger" : "text-ink-3"
                            }
                          >
                            ({run.status})
                          </span>
                        </span>
                        <span className="text-xs text-ink-3">
                          +{run.offersAdded} / ~{run.offersUpdated} ·{" "}
                          {new Date(run.startedAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">
                  Catalog ({filteredCatalog.length} of {data.catalog.length} endpoints)
                </h2>
                <input
                  type="search"
                  className="input-field max-w-xs text-xs"
                  placeholder="Filter endpoints…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <AdminDataTable
                columns={catalogColumns}
                rows={filteredCatalog}
                rowKey={(r) => r.endpointKey ?? `${r.providerRoute}/${r.modelId}`}
                emptyLabel="No endpoints match."
              />
            </div>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
