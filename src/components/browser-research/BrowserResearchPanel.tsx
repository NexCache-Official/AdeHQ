"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AIEmployee } from "@/lib/types";
import {
  BROWSER_RESEARCH_UI_COPY,
  browserResearchFindingsSectionLabel,
  browserResearchRunLabel,
  browserResearchSourceSectionLabel,
  canEmployeeUseBrowserResearch,
  getBrowserResearchAccessLabel,
  type BrowserResearchProvider,
  type BrowserResearchRun,
} from "@/lib/ai/browser-research";
import { authHeaders } from "@/lib/api/auth-client";
import { useStore } from "@/lib/demo-store";
import { Button, Card } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";
import { ExternalLink, FileText, Globe, Loader2, Search } from "lucide-react";

type BrowserResearchPanelProps = {
  employee: AIEmployee;
  roomId?: string;
  topicId?: string;
  compact?: boolean;
};

type ProviderConfig = {
  providerPref: BrowserResearchProvider;
  effectiveProvider: BrowserResearchProvider;
  tavilyConfigured: boolean;
  browserbaseConfigured?: boolean;
  liveEnabled?: boolean;
  liveReady?: boolean;
  fallbackReason?: string;
};

function BrowserEvidenceThumbnail({
  workspaceId,
  evidenceId,
  title,
}: {
  workspaceId: string;
  evidenceId: string;
  title: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({
          workspaceId,
          type: "evidence",
          id: evidenceId,
        });
        const res = await fetch(`/api/drive/download?${params.toString()}`, {
          headers: await authHeaders(),
        });
        const data = (await res.json()) as { signedUrl?: string };
        if (!cancelled && data.signedUrl) setSignedUrl(data.signedUrl);
      } catch {
        // evidence preview is optional
      } finally {
        if (!cancelled) setLoadingEvidence(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evidenceId, workspaceId]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {signedUrl ? (
        <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="block">
          <img
            src={signedUrl}
            alt={title}
            className="h-20 w-full object-cover object-top"
          />
        </a>
      ) : (
        <div className="flex h-20 items-center justify-center bg-slate-50 text-[10px] text-slate-400">
          {loadingEvidence ? "Loading…" : "No preview"}
        </div>
      )}
      <div className="truncate px-2 py-1 text-[10px] text-slate-600">{title}</div>
    </div>
  );
}

export function BrowserResearchPanel({
  employee,
  roomId,
  topicId,
  compact = false,
}: BrowserResearchPanelProps) {
  const { state, backend } = useStore();
  const workspaceId = state.workspace?.id;
  const [query, setQuery] = useState("");
  const [runs, setRuns] = useState<BrowserResearchRun[]>([]);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const allowed = useMemo(() => canEmployeeUseBrowserResearch(employee), [employee]);
  const accessLabel = useMemo(() => getBrowserResearchAccessLabel(employee), [employee]);
  const effectiveProvider = providerConfig?.effectiveProvider ?? "mock";
  const liveEnabled = providerConfig?.liveEnabled ?? false;
  const createButtonLabel =
    effectiveProvider === "browserbase"
      ? BROWSER_RESEARCH_UI_COPY.createBrowserbaseRun
      : effectiveProvider === "tavily"
        ? BROWSER_RESEARCH_UI_COPY.createTavilyRun
        : BROWSER_RESEARCH_UI_COPY.createMockRun;

  const loadRuns = useCallback(async () => {
    if (!workspaceId || backend !== "supabase" || !allowed) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspaceId });
      if (topicId) params.set("topicId", topicId);
      params.set("employeeId", employee.id);
      const res = await fetch(`/api/browser-research/runs?${params.toString()}`, {
        headers: await authHeaders(),
      });
      const data = (await res.json()) as {
        runs?: BrowserResearchRun[];
        config?: ProviderConfig;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load research runs.");
      setRuns(data.runs ?? []);
      if (data.config) setProviderConfig(data.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load research runs.");
    } finally {
      setLoading(false);
    }
  }, [allowed, backend, employee.id, topicId, workspaceId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  if (!allowed) return null;

  const createRun = async () => {
    if (!workspaceId || backend !== "supabase") {
      setError("Browser research runs require a connected workspace.");
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Enter a research question first.");
      return;
    }

    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/browser-research/runs", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          roomId: roomId ?? null,
          topicId: topicId ?? null,
          employeeId: employee.id,
          query: trimmed,
        }),
      });
      const data = (await res.json()) as {
        run?: BrowserResearchRun;
        message?: string;
        config?: ProviderConfig;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to create research run.");
      if (data.run) {
        setRuns((current) => [data.run!, ...current.filter((run) => run.id !== data.run!.id)]);
      }
      if (data.config) setProviderConfig(data.config);
      setMessage(data.message ?? null);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create research run.");
    } finally {
      setCreating(false);
    }
  };

  const latest = runs[0];
  const reportArtifactId =
    typeof latest?.metadata?.reportArtifactId === "string"
      ? latest.metadata.reportArtifactId
      : undefined;
  const evidenceSources =
    latest?.mockSources.filter((source) => source.evidenceId) ?? [];

  const openReport = (artifactId: string) => {
    if (!topicId) return;
    window.dispatchEvent(
      new CustomEvent("adehq:open-artifact", {
        detail: { artifactId, topicId },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("adehq:topic-artifacts-changed", { detail: { topicId } }),
    );
  };

  return (
    <Card className={cn("p-4", compact && "p-3")}>
      <div className="mb-3 flex items-start gap-2">
        <Globe className="mt-0.5 h-4 w-4 text-accent-600" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Browser research</h3>
            {liveEnabled ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                {BROWSER_RESEARCH_UI_COPY.liveBadge}
              </span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                {BROWSER_RESEARCH_UI_COPY.skeletonBadge}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">{BROWSER_RESEARCH_UI_COPY.preparing}</p>
          <p className="mt-1 text-xs text-slate-600">
            Research access: <span className="font-medium">{accessLabel}</span>
          </p>
          {effectiveProvider === "tavily" && !liveEnabled && (
            <p className="mt-1 text-xs text-slate-500">{BROWSER_RESEARCH_UI_COPY.searchNotBrowsing}</p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-600">
          What should this employee research?
        </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={compact ? 2 : 3}
          placeholder="e.g. Research competitors for AdeHQ"
          className="input-field w-full resize-none text-[13px]"
          maxLength={1000}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void createRun()} disabled={creating || !query.trim()}>
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {createButtonLabel}
          </Button>
          {!liveEnabled && (
            <span className="text-[11px] text-slate-500">{BROWSER_RESEARCH_UI_COPY.liveLater}</span>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {message && <p className="text-xs text-emerald-700">{message}</p>}
        {loading && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading runs…
          </p>
        )}

        {latest && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-800">
                  {browserResearchRunLabel(latest.provider)}
                </div>
                <div className="text-[11px] text-slate-500">{timeAgo(latest.createdAt)}</div>
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {latest.status}
              </span>
            </div>
            <p className="text-[13px] text-slate-700">{latest.query}</p>

            {latest.plannedSteps.length > 0 && (
              <section className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Planned steps
                </div>
                <ul className="mt-1 space-y-1">
                  {latest.plannedSteps.map((step) => (
                    <li key={step.title} className="text-xs text-slate-600">
                      <span className="font-medium text-slate-700">{step.title}</span>
                      {" — "}
                      {step.description}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {latest.mockSources.length > 0 && (
              <section className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {browserResearchSourceSectionLabel(latest.provider)}
                </div>
                <ul className="mt-1 space-y-2">
                  {latest.mockSources.map((source) => (
                    <li
                      key={source.url}
                      className={cn(
                        "rounded-lg border bg-white p-2",
                        latest.provider === "mock"
                          ? "border-dashed border-slate-300"
                          : "border-slate-200",
                      )}
                    >
                      <div className="text-xs font-medium text-slate-800">{source.title}</div>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-[11px] text-accent-700 hover:underline"
                      >
                        {source.url}
                      </a>
                      <div className="mt-1 text-[11px] text-slate-600">{source.note}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {latest.findings.length > 0 && (
              <section className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {browserResearchFindingsSectionLabel(latest.provider)}
                </div>
                <ul className="mt-1 space-y-2">
                  {latest.findings.map((finding) => (
                    <li key={finding.title} className="text-xs text-slate-600">
                      <span className="font-medium text-slate-700">{finding.title}</span>
                      {" — "}
                      {finding.summary}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {latest.status === "completed" &&
              latest.provider === "browserbase" &&
              reportArtifactId && (
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openReport(reportArtifactId)}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {BROWSER_RESEARCH_UI_COPY.viewReport}
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </Button>
                </div>
              )}

            {latest.status === "completed" &&
              latest.provider === "browserbase" &&
              evidenceSources.length > 0 &&
              workspaceId && (
                <section className="mt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {BROWSER_RESEARCH_UI_COPY.evidenceSection}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {evidenceSources.map((source) => (
                      <BrowserEvidenceThumbnail
                        key={source.evidenceId}
                        workspaceId={workspaceId}
                        evidenceId={source.evidenceId!}
                        title={source.title}
                      />
                    ))}
                  </div>
                </section>
              )}
          </div>
        )}

        {runs.length > 1 && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">{runs.length - 1} earlier research run(s)</summary>
            <ul className="mt-2 space-y-1">
              {runs.slice(1, 4).map((run) => (
                <li key={run.id}>
                  {run.query.slice(0, 80)}
                  {run.query.length > 80 ? "…" : ""} · {browserResearchRunLabel(run.provider)} ·{" "}
                  {run.status}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}
