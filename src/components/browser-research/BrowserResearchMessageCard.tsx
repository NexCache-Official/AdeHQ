"use client";

import type { BrowserResearchRun } from "@/lib/ai/browser-research";
import {
  BROWSER_RESEARCH_UI_COPY,
  browserResearchFindingsSectionLabel,
  browserResearchRunLabel,
  browserResearchSourceSectionLabel,
} from "@/lib/ai/browser-research";
import { authHeaders } from "@/lib/api/auth-client";
import { parseJsonResponse } from "@/lib/api/parse-json-response";
import { Button } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";
import { ExternalLink, FileText, Globe, Loader2, MonitorPlay } from "lucide-react";
import { useEffect, useState } from "react";

type BrowserResearchMessageCardProps = {
  run: BrowserResearchRun;
  workspaceId: string;
  topicId?: string;
  employeeName?: string;
  pending?: boolean;
};

function EvidenceThumb({
  workspaceId,
  evidenceId,
  title,
}: {
  workspaceId: string;
  evidenceId: string;
  title: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ workspaceId, type: "evidence", id: evidenceId });
        const res = await fetch(`/api/drive/download?${params.toString()}`, {
          headers: await authHeaders(),
        });
        const data = await parseJsonResponse<{ signedUrl?: string }>(res);
        if (!cancelled && data.signedUrl) setSignedUrl(data.signedUrl);
      } catch {
        // optional preview
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evidenceId, workspaceId]);

  if (!signedUrl) return null;
  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-lg border border-border bg-surface"
    >
      <img src={signedUrl} alt={title} className="h-16 w-full object-cover object-top" />
    </a>
  );
}

export function BrowserResearchMessageCard({
  run,
  workspaceId,
  topicId,
  employeeName,
  pending = false,
}: BrowserResearchMessageCardProps) {
  const [showLiveEmbed, setShowLiveEmbed] = useState(false);
  const reportArtifactId =
    typeof run.metadata?.reportArtifactId === "string" ? run.metadata.reportArtifactId : undefined;
  const liveSessionUrl =
    typeof run.metadata?.liveSessionUrl === "string" ? run.metadata.liveSessionUrl : undefined;
  const resolvedQuery =
    typeof run.metadata?.resolvedQuery === "string" ? run.metadata.resolvedQuery : run.query;
  const evidenceSources = run.mockSources.filter((source) => source.evidenceId);
  const isLiveActive =
    pending || run.status === "running" || run.status === "planning" || run.status === "created";
  const showLiveViewer = run.provider === "browserbase" && Boolean(liveSessionUrl) && isLiveActive;

  const openReport = () => {
    if (!reportArtifactId || !topicId) return;
    window.dispatchEvent(
      new CustomEvent("adehq:open-artifact", { detail: { artifactId: reportArtifactId, topicId } }),
    );
    window.dispatchEvent(
      new CustomEvent("adehq:topic-artifacts-changed", { detail: { topicId } }),
    );
  };

  return (
    <div className="rounded-2xl border border-accent/20 bg-accent-soft/40 p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Globe className="mt-0.5 h-4 w-4 text-accent-600" />
          <div>
            <div className="text-sm font-semibold text-ink">
              {employeeName ? `${employeeName} — browser research` : "Browser research"}
            </div>
            <div className="text-[11px] text-ink-3">
              {browserResearchRunLabel(run.provider)} · {timeAgo(run.createdAt)}
            </div>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            isLiveActive
              ? "bg-amber-50 text-amber-800"
              : run.status === "completed"
                ? "bg-emerald-50 text-emerald-800"
                : "bg-slate-100 text-slate-600",
          )}
        >
          {pending ? "running…" : run.status}
        </span>
      </div>

      <p className="text-[13px] font-medium text-ink-2">{resolvedQuery}</p>

      {isLiveActive && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {run.provider === "browserbase"
            ? BROWSER_RESEARCH_UI_COPY.liveBrowsingStatus
            : BROWSER_RESEARCH_UI_COPY.searchingStatus}
        </p>
      )}

      {showLiveViewer && liveSessionUrl && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <a
              href={liveSessionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-ink hover:bg-muted"
            >
              <MonitorPlay className="h-3.5 w-3.5" />
              {BROWSER_RESEARCH_UI_COPY.watchLiveBrowser}
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => setShowLiveEmbed((open) => !open)}
            >
              {showLiveEmbed ? "Hide embed" : "Embed preview"}
            </Button>
          </div>
          {showLiveEmbed && (
            <iframe
              src={liveSessionUrl}
              className="h-[360px] w-full rounded-lg border border-border bg-white"
              title={BROWSER_RESEARCH_UI_COPY.liveBrowserEmbedTitle}
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          )}
        </div>
      )}

      {run.findings.length > 0 && (
        <section className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            {browserResearchFindingsSectionLabel(run.provider)}
          </div>
          <ul className="mt-1 space-y-1.5">
            {run.findings.slice(0, 6).map((finding) => (
              <li key={`${finding.title}-${finding.summary.slice(0, 24)}`} className="text-xs text-ink-2">
                <span className="font-medium text-ink">{finding.title}</span>
                {" — "}
                {finding.summary}
              </li>
            ))}
          </ul>
        </section>
      )}

      {run.mockSources.length > 0 && (
        <section className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            {browserResearchSourceSectionLabel(run.provider)}
          </div>
          <ul className="mt-1 space-y-2">
            {run.mockSources.slice(0, 4).map((source) => (
              <li key={source.url} className="rounded-lg border border-border bg-surface px-2.5 py-2">
                <div className="text-xs font-medium text-ink">{source.title}</div>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[11px] text-accent-700 hover:underline"
                >
                  {source.url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {evidenceSources.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {evidenceSources.map((source) => (
            <EvidenceThumb
              key={source.evidenceId}
              workspaceId={workspaceId}
              evidenceId={source.evidenceId!}
              title={source.title}
            />
          ))}
        </div>
      )}

      {reportArtifactId && topicId && run.status === "completed" && (
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={openReport}>
            <FileText className="h-3.5 w-3.5" />
            {BROWSER_RESEARCH_UI_COPY.viewReport}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Button>
        </div>
      )}
    </div>
  );
}
