"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MessageArtifact } from "@/lib/types";

type SearchSourceCardData = NonNullable<
  NonNullable<MessageArtifact["meta"]>["searchSources"]
>[number];

function confidenceLabel(confidence?: string): string {
  if (confidence === "high") return "High confidence";
  if (confidence === "low") return "Low confidence";
  return "Medium confidence";
}

function confidenceClass(confidence?: string): string {
  if (confidence === "high") return "bg-emerald-50 text-emerald-800";
  if (confidence === "low") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-800";
}

function SourceCard({ source }: { source: SearchSourceCardData }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-[10px] border border-border bg-surface px-3 py-2.5 transition-colors hover:border-accent/30 hover:bg-accent-soft/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">
            {source.domain || "source"}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[13.8px] font-medium text-ink group-hover:text-accent-d">
            {source.title}
          </p>
        </div>
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3 opacity-70 group-hover:text-accent" />
      </div>
      {source.snippet ? (
        <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-3">
          {source.snippet}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
            confidenceClass(source.confidence),
          )}
        >
          {confidenceLabel(source.confidence)}
        </span>
        {source.sourceType ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-ink-3">
            {source.sourceType.replace(/_/g, " ")}
          </span>
        ) : null}
      </div>
    </a>
  );
}

export function SearchSourceCards({ artifact }: { artifact: MessageArtifact }) {
  const sources = artifact.meta?.searchSources ?? [];
  const [expanded, setExpanded] = useState(false);

  const visibleSources = useMemo(
    () => (expanded ? sources : sources.slice(0, 3)),
    [expanded, sources],
  );

  if (!sources.length) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Sources</p>
        {artifact.meta?.usedSourceCount ? (
          <span className="text-[11.5px] text-ink-3">
            {artifact.meta.usedSourceCount} cited
          </span>
        ) : null}
      </div>
      <div className="grid gap-2">
        {visibleSources.map((source) => (
          <SourceCard key={source.id} source={source} />
        ))}
      </div>
      {sources.length > 3 ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="text-[12.5px] font-medium text-accent hover:underline"
        >
          {expanded ? "Show fewer sources" : `View all ${sources.length} sources`}
        </button>
      ) : null}
    </div>
  );
}
