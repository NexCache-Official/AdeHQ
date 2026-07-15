"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/demo-store";
import { authHeaders } from "@/lib/api/auth-client";
import {
  DEFAULT_SILICONFLOW_MODEL,
  ENABLE_DEMO_MODE,
} from "@/lib/config/features";
import { MODEL_MODE_LABELS, type ModelMode } from "@/lib/ai/model-catalog";
import { Button, Card } from "./ui";
import { Activity, Bot, Sparkles, Zap } from "lucide-react";

type RuntimeSnapshot = {
  siliconflowConfigured?: boolean;
  gatewayAvailable?: boolean;
  defaultProvider?: string;
  defaultSiliconflowModel?: string;
  environment: string;
  demoModeEnabled: boolean;
  runtimeV2Mode?: string;
  providerPref?: string;
  routeOptimizerMode?: string;
  priceMaxAgeHours?: number;
  catalogSummary?: { offerCount: number; enabledCount: number };
  optimizerPreview?: {
    selected: string;
    reason: string;
    estimatedCostUsd: number;
    fallbacks: Array<{ providerRoute: string; modelId: string; gatewayProviderSlug?: string; endpointKey?: string }>;
    priceSource: string;
    priceFreshness: string;
    healthNote?: string;
    shadowOnly?: boolean;
    optimizerWouldChoose?: string;
    optimizerReason?: string;
    optimizerEstimatedCostUsd?: number;
    catalogMatch?: {
      found: boolean;
      endpointKey?: string;
      inputCostPerMillion?: number;
      outputCostPerMillion?: number;
      source?: string;
      verifiedAt?: string;
      priceFetchedAt?: string | null;
      ambiguousEndpointCount?: number;
    };
    optimizerCatalogMatch?: {
      found: boolean;
      endpointKey?: string;
      inputCostPerMillion?: number;
      outputCostPerMillion?: number;
      source?: string;
      verifiedAt?: string;
    };
    decisionFactors?: {
      costRank: number;
      qualityRank: number;
      latencyRank: number;
      reliabilityRank: number;
      healthPenalty: number;
      stalePricePenalty: number;
      antiFlapApplied: boolean;
    };
  };
  employeeDirectExecution?: boolean;
  employeeQueuedExecution?: boolean;
  catalog?: {
    offers: Array<{
      endpointKey?: string;
      providerRoute: string;
      gatewayProviderSlug?: string;
      providerDisplayName?: string;
      modelId: string;
      displayName: string;
      contextWindow?: number;
      maxOutputTokens?: number;
      inputCostPerMillion?: number;
      outputCostPerMillion?: number;
      cachedInputCostPerMillion?: number;
      originalInputCostPerMillion?: number;
      originalOutputCostPerMillion?: number;
      pricingDiscountActive?: boolean;
      pricingNotes?: string;
      source: string;
      priceFetchedAt?: string | null;
      enabled: boolean;
      metadata?: {
        verifiedAt?: string;
        verifiedBy?: string;
        sourceUrl?: string;
        notes?: string;
        priceSource?: string;
      };
    }>;
    syncRuns: Array<Record<string, unknown>>;
  };
  routingPreview?: Array<{
    label?: string;
    capability: string;
    providerRoute: string;
    modelId?: string;
    gatewayProviderSlug?: string;
    endpointKey?: string;
    runtimeMode: string;
    estimatedWorkMinutes: number;
    estimatedCostUsd?: number;
    pinnedPolicy?: { policyKey: string; reason: string; gatewayFallbackApplied?: boolean };
    fallbackCandidates: string[];
    routeOptimizer?: Record<string, unknown>;
  }>;
  last?: {
    at: string;
    provider: string;
    model: string;
    modelMode?: string;
    mode: string;
    fallbackReason?: string;
    error?: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
    durationMs?: number;
  };
  recent: {
    at: string;
    provider: string;
    model: string;
    modelMode?: string;
    mode: string;
    fallbackReason?: string;
    error?: string;
  }[];
};

export function AiRuntimePanel() {
  const { state, backend } = useStore();
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [testEmployeeId, setTestEmployeeId] = useState("");
  const [testRoomId, setTestRoomId] = useState("");
  const [testPrompt, setTestPrompt] = useState("What can you help with in this workspace?");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testMode, setTestMode] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [providerTestMode, setProviderTestMode] = useState<ModelMode>("cheap");
  const [providerTestPrompt, setProviderTestPrompt] = useState("Reply with one short sentence.");
  const [providerTestResult, setProviderTestResult] = useState<string | null>(null);
  const [providerTestBusy, setProviderTestBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [catalogFilter, setCatalogFilter] = useState("");

  const filteredCatalogOffers = useMemo(() => {
    const offers = snapshot?.catalog?.offers ?? [];
    const q = catalogFilter.trim().toLowerCase();
    if (!q) return offers;
    return offers.filter((offer) => {
      const haystack = [
        offer.endpointKey,
        offer.providerRoute,
        offer.gatewayProviderSlug,
        offer.modelId,
        offer.displayName,
        offer.providerDisplayName,
        offer.source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [snapshot?.catalog?.offers, catalogFilter]);

  const canAdmin =
    backend === "supabase" &&
    state.workspaceMembers.some(
      (m) =>
        m.userId === state.user?.id && m.role === "admin",
    );
  const roomsForSelectedEmployee = useMemo(
    () =>
      testEmployeeId
        ? state.rooms.filter((r) => r.aiEmployees.includes(testEmployeeId))
        : state.rooms,
    [state.rooms, testEmployeeId],
  );

  const refreshSnapshot = async () => {
    if (!state.workspace.id) return;
    const headers = await authHeaders();
    const res = await fetch(`/api/ai/runtime?workspaceId=${state.workspace.id}`, { headers });
    if (!res.ok) throw new Error("Unable to load runtime status.");
    return (await res.json()) as RuntimeSnapshot;
  };

  useEffect(() => {
    if (!canAdmin || !state.workspace.id) {
      setLoading(false);
      return;
    }

    let active = true;
    void (async () => {
      try {
        const data = await refreshSnapshot();
        if (active) setSnapshot(data ?? null);
      } catch {
        if (active) setSnapshot(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [canAdmin, state.workspace.id]);

  useEffect(() => {
    if (!testEmployeeId && state.employees[0]) setTestEmployeeId(state.employees[0].id);
  }, [state.employees, testEmployeeId]);

  useEffect(() => {
    if (!roomsForSelectedEmployee.length) {
      setTestRoomId("");
      return;
    }
    if (!testRoomId || !roomsForSelectedEmployee.some((r) => r.id === testRoomId)) {
      const preferred = roomsForSelectedEmployee.find((r) => r.id === state.employees.find((e) => e.id === testEmployeeId)?.defaultRoomId);
      setTestRoomId((preferred ?? roomsForSelectedEmployee[0]).id);
    }
  }, [roomsForSelectedEmployee, testRoomId, state.employees, testEmployeeId]);

  const runEmployeeTest = async () => {
    if (!testEmployeeId || !testRoomId || !testPrompt.trim()) return;
    setTestBusy(true);
    setTestResult(null);
    setTestMode(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/employees/${testEmployeeId}/respond`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          roomId: testRoomId,
          content: testPrompt.trim(),
          mode: "live",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed.");
      setTestResult(data.reply);
      setTestMode(data.aiMode ?? res.headers.get("x-adehq-ai-mode") ?? "unknown");
      const snap = await refreshSnapshot();
      setSnapshot(snap ?? null);
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setTestBusy(false);
    }
  };

  const runProviderTest = async () => {
    if (!state.workspace.id || !providerTestPrompt.trim()) return;
    setProviderTestBusy(true);
    setProviderTestResult(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/ai/test-provider`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspaceId: state.workspace.id,
          modelMode: providerTestMode,
          prompt: providerTestPrompt.trim(),
        }),
      });

      const raw = await res.text();
      let data: { ok?: boolean; error?: string; reply?: string; provider?: string; model?: string; latencyMs?: number; fallbackTier?: number };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        if (res.status === 404) {
          throw new Error(
            "Test provider API not found. Redeploy the latest version of AdeHQ.",
          );
        }
        throw new Error(raw.slice(0, 200) || `HTTP ${res.status}`);
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Provider test failed (HTTP ${res.status}).`);
      }

      setProviderTestResult(
        `${data.reply}\n\n(${data.provider}/${data.model} · ${data.latencyMs}ms · health check)`,
      );
      const snap = await refreshSnapshot();
      setSnapshot(snap ?? null);
    } catch (err) {
      setProviderTestResult(err instanceof Error ? err.message : "Provider test failed.");
    } finally {
      setProviderTestBusy(false);
    }
  };

  if (!canAdmin) return null;

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-600" />
        <h2 className="text-sm font-semibold text-slate-900">AI Runtime</h2>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading runtime status…</p>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Stat label="Runtime mode" value={snapshot?.runtimeV2Mode ?? "off"} />
          <Stat label="Route optimizer" value={snapshot?.routeOptimizerMode ?? "off"} />
          <Stat label="Provider preference" value={snapshot?.providerPref ?? "auto"} />
          <Stat label="SiliconFlow available" value={snapshot?.siliconflowConfigured ? "Yes" : "No"} />
          <Stat label="Gateway available" value={snapshot?.gatewayAvailable ? "Yes" : "No"} />
          <Stat
            label="Hot path direct execution"
            value={snapshot?.employeeDirectExecution ? "Enabled" : "Disabled"}
          />
          <Stat
            label="Hot path queued execution"
            value={snapshot?.employeeQueuedExecution ? "Enabled" : "Disabled"}
          />
          <Stat label="Environment" value={snapshot?.environment ?? "unknown"} />
          <Stat label="Demo mode enabled" value={ENABLE_DEMO_MODE ? "Yes" : "No"} />
          <Stat
            label="Last request"
            value={
              snapshot?.last
                ? `${snapshot.last.mode} · ${snapshot.last.provider} · ${snapshot.last.model}`
                : "None yet"
            }
          />
          {snapshot?.last?.modelMode && (
            <Stat label="Last mode" value={snapshot.last.modelMode} />
          )}
          {snapshot?.last?.estimatedCostUsd !== undefined && (
            <Stat label="Last est. cost" value={`$${snapshot.last.estimatedCostUsd.toFixed(6)}`} />
          )}
          {snapshot?.last?.fallbackReason && (
            <Stat label="Last fallback reason" value={snapshot.last.fallbackReason} />
          )}
          {snapshot?.last?.error && <Stat label="Last error" value={snapshot.last.error} />}
        </dl>
      )}

      {snapshot?.optimizerPreview && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Why this route?
          </h3>
          <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <div>
              <span className="font-medium text-slate-800">Selected:</span>{" "}
              {snapshot.optimizerPreview.selected}
            </div>
            <div>
              <span className="font-medium text-slate-800">Reason:</span>{" "}
              {snapshot.optimizerPreview.reason}
            </div>
            {snapshot.optimizerPreview.optimizerWouldChoose && (
              <>
                <div>
                  <span className="font-medium text-slate-800">Optimizer would choose:</span>{" "}
                  {snapshot.optimizerPreview.optimizerWouldChoose}
                </div>
                {snapshot.optimizerPreview.optimizerReason && (
                  <div>
                    <span className="font-medium text-slate-800">Optimizer reason:</span>{" "}
                    {snapshot.optimizerPreview.optimizerReason}
                  </div>
                )}
                {snapshot.optimizerPreview.optimizerEstimatedCostUsd != null && (
                  <div>
                    <span className="font-medium text-slate-800">Optimizer est. cost:</span> $
                    {snapshot.optimizerPreview.optimizerEstimatedCostUsd.toFixed(6)}
                  </div>
                )}
              </>
            )}
            <div>
              <span className="font-medium text-slate-800">Est. cost:</span> $
              {snapshot.optimizerPreview.estimatedCostUsd.toFixed(6)}
            </div>
            <div>
              <span className="font-medium text-slate-800">Price source:</span>{" "}
              {snapshot.optimizerPreview.priceSource} ({snapshot.optimizerPreview.priceFreshness})
            </div>
            {snapshot.optimizerPreview.catalogMatch?.found ? (
              <div className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-900">
                <div className="font-medium">Catalog match</div>
                <div>
                  {snapshot.optimizerPreview.catalogMatch.endpointKey}
                </div>
                <div>
                  ${snapshot.optimizerPreview.catalogMatch.inputCostPerMillion ?? "?"} / $
                  {snapshot.optimizerPreview.catalogMatch.outputCostPerMillion ?? "?"} ·{" "}
                  {snapshot.optimizerPreview.catalogMatch.source}
                </div>
                {snapshot.optimizerPreview.catalogMatch.verifiedAt && (
                  <div>verified {snapshot.optimizerPreview.catalogMatch.verifiedAt}</div>
                )}
                {snapshot.optimizerPreview.catalogMatch.ambiguousEndpointCount != null && (
                  <div>
                    {snapshot.optimizerPreview.catalogMatch.ambiguousEndpointCount} endpoints share
                    this model — showing primary row
                  </div>
                )}
              </div>
            ) : (
              snapshot.optimizerPreview.catalogMatch && (
                <div className="mt-1 text-[11px] text-slate-500">
                  No matching catalog endpoint row for this static route.
                </div>
              )
            )}
            {snapshot.optimizerPreview.optimizerCatalogMatch?.found && (
              <div className="mt-1 rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-indigo-900">
                <div className="font-medium">Optimizer catalog match</div>
                <div>{snapshot.optimizerPreview.optimizerCatalogMatch.endpointKey}</div>
                <div>
                  ${snapshot.optimizerPreview.optimizerCatalogMatch.inputCostPerMillion ?? "?"} / $
                  {snapshot.optimizerPreview.optimizerCatalogMatch.outputCostPerMillion ?? "?"} ·{" "}
                  {snapshot.optimizerPreview.optimizerCatalogMatch.source}
                </div>
              </div>
            )}
            {snapshot.optimizerPreview.healthNote && (
              <div>
                <span className="font-medium text-slate-800">Health:</span>{" "}
                {snapshot.optimizerPreview.healthNote}
              </div>
            )}
            {snapshot.optimizerPreview.decisionFactors && (
              <div className="mt-1 text-[11px] text-slate-500">
                cost #{snapshot.optimizerPreview.decisionFactors.costRank} · quality #
                {snapshot.optimizerPreview.decisionFactors.qualityRank} · latency #
                {snapshot.optimizerPreview.decisionFactors.latencyRank}
              </div>
            )}
          </div>
        </div>
      )}

      {snapshot?.catalog?.offers && snapshot.catalog.offers.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Manual seed prices are fallback only. Live provider-endpoint pricing is preferred.
            Changing embedding model requires reindexing file chunks.
          </div>
          {snapshot.catalog.offers.some(
            (o) => o.source === "manual_seed" || !o.priceFetchedAt,
          ) && (
            <div className="mb-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
              Stale or manual prices shown — run Refresh model pricing.
            </div>
          )}
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Model catalog ({snapshot.catalog.offers.length} endpoints)
            </h3>
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              disabled={syncBusy || !state.workspace?.id}
              onClick={async () => {
                if (!state.workspace?.id) return;
                setSyncBusy(true);
                setSyncResult(null);
                try {
                  const res = await fetch("/api/admin/models/pricing/sync", {
                    method: "POST",
                    headers: await authHeaders(),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error ?? "Sync failed");
                  setSyncResult(
                    `Synced: +${data.totalAdded} / ~${data.totalUpdated} updated / ${data.totalDisabled} disabled`,
                  );
                  const snap = await refreshSnapshot();
                  setSnapshot(snap ?? null);
                } catch (err) {
                  setSyncResult(err instanceof Error ? err.message : "Sync failed");
                } finally {
                  setSyncBusy(false);
                }
              }}
            >
              {syncBusy ? "Refreshing…" : "Refresh model pricing"}
            </Button>
          </div>
          {syncResult && <p className="mb-2 text-xs text-slate-500">{syncResult}</p>}
          <input
            type="search"
            className="input-field mb-2 text-xs"
            placeholder="Filter endpoints (e.g. vercel_gateway, deepseek-v4-pro, blackbox)"
            value={catalogFilter}
            onChange={(e) => setCatalogFilter(e.target.value)}
          />
          {catalogFilter.trim() && (
            <p className="mb-2 text-[11px] text-slate-500">
              Showing {filteredCatalogOffers.length} of {snapshot.catalog.offers.length} endpoints
            </p>
          )}
          {snapshot.catalog.syncRuns?.length > 0 && (
            <div className="mb-2 text-[11px] text-slate-500">
              Last sync:{" "}
              {String(snapshot.catalog.syncRuns[0]?.started_at ?? snapshot.catalog.syncRuns[0]?.startedAt ?? "—")}
              {" · "}
              {String(snapshot.catalog.syncRuns[0]?.status ?? "—")}
            </div>
          )}
          <div className="max-h-64 overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
            <table className="min-w-full text-left text-[11px] text-slate-600">
              <thead className="sticky top-0 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Endpoint</th>
                  <th className="px-2 py-1.5 font-medium">Model</th>
                  <th className="px-2 py-1.5 font-medium">Context</th>
                  <th className="px-2 py-1.5 font-medium">In / Out</th>
                  <th className="px-2 py-1.5 font-medium">Cache*</th>
                  <th className="px-2 py-1.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {filteredCatalogOffers.slice(0, 80).map((offer) => {
                  const key = offer.endpointKey ?? `${offer.providerRoute}:${offer.modelId}`;
                  return (
                    <tr key={key} className="border-t border-slate-200">
                      <td className="px-2 py-1.5 align-top">
                        <div className="font-medium text-slate-800">{offer.providerDisplayName ?? offer.gatewayProviderSlug ?? "default"}</div>
                        <div className="text-[10px] text-slate-400">{offer.endpointKey ?? key}</div>
                        {offer.pricingDiscountActive && (
                          <span className="mt-0.5 inline-block rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-medium text-emerald-700">
                            discount
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <div>{offer.displayName}</div>
                        <div className="text-[10px] text-slate-400">{offer.providerRoute}</div>
                        {!offer.enabled && (
                          <span className="text-[10px] text-red-600">disabled</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap">
                        {offer.contextWindow != null
                          ? `${Math.round(offer.contextWindow / 1000)}K`
                          : "—"}
                        {offer.maxOutputTokens != null && (
                          <div className="text-[10px] text-slate-400">
                            max out {Math.round(offer.maxOutputTokens / 1000)}K
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap">
                        ${offer.inputCostPerMillion ?? "?"} / ${offer.outputCostPerMillion ?? "?"}
                        {offer.pricingDiscountActive &&
                          offer.originalInputCostPerMillion != null && (
                            <div className="text-[10px] text-slate-400 line-through">
                              ${offer.originalInputCostPerMillion} / $
                              {offer.originalOutputCostPerMillion ?? "?"}
                            </div>
                          )}
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap text-slate-400">
                        {offer.cachedInputCostPerMillion != null
                          ? `$${offer.cachedInputCostPerMillion}`
                          : "—"}
                        <div className="text-[9px]">not in estimates</div>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <div>{offer.source}</div>
                        {offer.metadata?.verifiedAt && (
                          <div className="text-[10px] text-slate-400">
                            verified {offer.metadata.verifiedAt}
                          </div>
                        )}
                        {offer.metadata?.notes && (
                          <div className="max-w-[140px] truncate text-[10px] text-slate-400" title={offer.metadata.notes}>
                            {offer.metadata.notes}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">* Cached input price stored but not used in optimizer cost estimates.</p>
        </div>
      )}

      {snapshot?.routingPreview && snapshot.routingPreview.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Pinned route preview (V20.1.2)
          </h3>
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {snapshot.routingPreview.map((row) => (
              <div key={`${row.label ?? row.capability}-${row.modelId}`} className="text-xs text-slate-600">
                <span className="font-medium text-slate-800">{row.label ?? row.capability}</span>
                {" → "}
                {row.providerRoute} / {row.modelId}
                {row.gatewayProviderSlug && row.gatewayProviderSlug !== "default"
                  ? ` / ${row.gatewayProviderSlug}`
                  : ""}
                {row.pinnedPolicy?.reason && (
                  <span className="ml-1 text-[11px] text-emerald-700">· {row.pinnedPolicy.reason}</span>
                )}
                {row.pinnedPolicy?.gatewayFallbackApplied && (
                  <span className="ml-1 text-[11px] text-amber-700">· gateway fallback</span>
                )}
                {row.routeOptimizer && (row.routeOptimizer as { shadowOnly?: boolean }).shadowOnly && (
                  <span className="ml-1 text-[11px] text-indigo-600">
                    · optimizer shadow: would choose{" "}
                    {(row.routeOptimizer as { selectedModelId?: string }).selectedModelId ?? "?"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {snapshot?.recent && snapshot.recent.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Recent runtime events
          </h3>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
            {snapshot.recent.map((entry, i) => (
              <div key={entry.at + entry.model + i} className="text-xs text-slate-600">
                <Activity className="mr-1 inline h-3 w-3" />
                {entry.mode} · {entry.provider}/{entry.model}
                {entry.modelMode ? ` · ${entry.modelMode}` : ""}
                {entry.fallbackReason ? ` · ${entry.fallbackReason}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Zap className="h-4 w-4 text-accent-600" /> Test provider (isolated)
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Health-check SiliconFlow without room context. Run this before debugging employee replies.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            className="input-field"
            value={providerTestMode}
            onChange={(e) => setProviderTestMode(e.target.value as ModelMode)}
          >
            {(Object.keys(MODEL_MODE_LABELS) as ModelMode[])
              .filter((m) => m !== "creative")
              .map((m) => (
                <option key={m} value={m}>
                  {MODEL_MODE_LABELS[m]}
                </option>
              ))}
          </select>
        </div>
        <textarea
          className="input-field mt-3 min-h-[60px]"
          value={providerTestPrompt}
          onChange={(e) => setProviderTestPrompt(e.target.value)}
        />
        <Button className="mt-3" size="sm" onClick={runProviderTest} disabled={providerTestBusy}>
          {providerTestBusy ? "Testing…" : "Test provider"}
        </Button>
        {providerTestResult && (
          <div className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-700 whitespace-pre-wrap">
            {providerTestResult}
          </div>
        )}
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Bot className="h-4 w-4 text-accent-600" /> Test employee reply
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            className="input-field"
            value={testEmployeeId}
            onChange={(e) => setTestEmployeeId(e.target.value)}
          >
            {state.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.provider}/{e.modelMode ?? "balanced"})
              </option>
            ))}
          </select>
          <select
            className="input-field"
            value={testRoomId}
            onChange={(e) => setTestRoomId(e.target.value)}
          >
            {roomsForSelectedEmployee.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            {!roomsForSelectedEmployee.length && (
              <option value="">No rooms contain this employee</option>
            )}
          </select>
        </div>
        <textarea
          className="input-field mt-3 min-h-[80px]"
          value={testPrompt}
          onChange={(e) => setTestPrompt(e.target.value)}
        />
        <Button className="mt-3" size="sm" onClick={runEmployeeTest} disabled={testBusy || !state.employees.length || !testRoomId}>
          {testBusy ? "Testing…" : "Run employee test"}
        </Button>
        {testResult && (
          <div className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-700">
            <p className="mb-1 text-xs font-medium text-slate-500">
              Response {testMode ? `(mode: ${testMode})` : ""}
            </p>
            {testResult}
          </div>
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
    </div>
  );
}
