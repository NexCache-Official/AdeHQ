"use client";

import { useState } from "react";
import { authHeaders } from "@/lib/api/auth-client";
import { Button, Card } from "@/components/ui";
import {
  AdminAsync,
  AdminHealthBadge,
  AdminMetricCard,
  AdminPageHeader,
  formatCount,
  formatUsd,
  useAdminData,
} from "@/components/admin/common";
import type { OverviewSummary } from "@/lib/admin/queries/overview";
import type { ProviderHealthCard } from "@/lib/admin/queries/models";
import { Gauge } from "lucide-react";

const RANGES = ["1d", "7d", "30d"] as const;

type OverviewResponse = {
  data: OverviewSummary;
  openIncidents: number;
  providerHealth: ProviderHealthCard[];
};

export default function AdminOverviewPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("7d");
  const { data: response, loading, error } = useAdminData<OverviewResponse>(
    `/api/admin/overview?range=${range}`,
  );
  const data = response?.data;

  const [copilotQ, setCopilotQ] = useState("");
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotAnswer, setCopilotAnswer] = useState<string | null>(null);

  const askCopilot = async () => {
    if (!copilotQ.trim()) return;
    setCopilotBusy(true);
    setCopilotAnswer(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/copilot", {
        method: "POST",
        headers,
        body: JSON.stringify({ question: copilotQ.trim(), range }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Copilot failed.");
      setCopilotAnswer(body.answer?.summary ?? "No answer.");
    } catch (err) {
      setCopilotAnswer(err instanceof Error ? err.message : "Copilot failed.");
    } finally {
      setCopilotBusy(false);
    }
  };

  const degradedProviders =
    response?.providerHealth?.filter((p) => p.status === "degraded").length ?? 0;

  return (
    <div>
      <AdminPageHeader
        title="Command Center"
        subtitle="Platform health at a glance."
        icon={<Gauge className="h-5 w-5" />}
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
        {data && response && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <AdminMetricCard label="MRR" value="—" hint="Revolut Pay revenue coming soon" />
              <AdminMetricCard
                label={`AI cost (${range})`}
                value={formatUsd(data.usage.totalCostUsd)}
                hint={`${formatCount(data.usage.eventCount)} events`}
              />
              <AdminMetricCard
                label="Active workspaces"
                value={formatCount(data.workspaces.activeInRange)}
                hint={`${formatCount(data.workspaces.total)} total`}
              />
              <AdminMetricCard
                label="New signups"
                value={formatCount(data.signups.week)}
                hint={`${data.signups.today} today · ${data.signups.month} this month`}
              />
              <AdminMetricCard
                label="Open incidents"
                value={formatCount(response.openIncidents)}
                hint={response.openIncidents > 0 ? "Needs attention" : "All clear"}
              />
              <AdminMetricCard
                label="Provider health"
                value={
                  <AdminHealthBadge
                    tone={degradedProviders > 0 ? "degraded" : "healthy"}
                    label={degradedProviders > 0 ? `${degradedProviders} degraded` : "Healthy"}
                  />
                }
              />
            </div>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Admin copilot</h2>
              <div className="flex gap-2">
                <input
                  className="input-field flex-1 text-sm"
                  placeholder="Ask about cost, growth, incidents, work hours…"
                  value={copilotQ}
                  onChange={(e) => setCopilotQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void askCopilot()}
                />
                <Button size="sm" disabled={copilotBusy || !copilotQ.trim()} onClick={() => void askCopilot()}>
                  {copilotBusy ? "Thinking…" : "Ask"}
                </Button>
              </div>
              {copilotAnswer && <p className="mt-3 text-sm text-ink-2">{copilotAnswer}</p>}
            </Card>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <AdminMetricCard label="AI employees" value={formatCount(data.aiEmployees)} />
              <AdminMetricCard label={`Messages (${range})`} value={formatCount(data.messagesInRange)} />
              <AdminMetricCard label={`Browser runs (${range})`} value={formatCount(data.browserRunsInRange)} />
              <AdminMetricCard
                label="Work Hours (shadow)"
                value={data.workHours.totalHours.toFixed(1)}
                hint={`${data.workHours.totalMinutes.toFixed(0)} minutes`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Cost by provider</h2>
                {data.usage.byProvider.length === 0 ? (
                  <p className="text-sm text-ink-3">No usage in this range.</p>
                ) : (
                  <div className="space-y-2">
                    {data.usage.byProvider.map((entry) => (
                      <div key={entry.key} className="flex items-center justify-between text-sm">
                        <span className="text-ink-2">{entry.key}</span>
                        <span className="tabular-nums text-ink">
                          {formatUsd(entry.value)}{" "}
                          <span className="text-xs text-ink-3">({entry.count})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-ink">Run health</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-2">Failed / blocked AI events</span>
                    <span className="tabular-nums font-medium text-ink">
                      {formatCount(data.usage.failedCount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-2">Fallbacks used</span>
                    <span className="tabular-nums font-medium text-ink">
                      {formatCount(data.usage.fallbackCount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-2">Disabled workspaces</span>
                    <span className="tabular-nums font-medium text-ink">
                      {formatCount(data.workspaces.disabled)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-2">Overall</span>
                    <AdminHealthBadge
                      tone={
                        data.usage.eventCount > 0 &&
                        data.usage.failedCount / data.usage.eventCount > 0.2
                          ? "degraded"
                          : "healthy"
                      }
                    />
                  </div>
                </div>
              </Card>
            </div>

            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Recent admin actions</h2>
              {data.recentAdminActions.length === 0 ? (
                <p className="text-sm text-ink-3">No admin actions recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.recentAdminActions.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between text-sm">
                      <span className="text-ink-2">
                        {entry.action}
                        {entry.targetId && (
                          <span className="text-ink-3"> · {entry.targetType}: {entry.targetId}</span>
                        )}
                      </span>
                      <span className="text-xs text-ink-3">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </AdminAsync>
    </div>
  );
}
