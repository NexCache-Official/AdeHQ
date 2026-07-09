"use client";

import { ExternalLink, Sparkles } from "lucide-react";
import type { MessageArtifact } from "@/lib/types";
import {
  resolveKnowledgeSources,
  resolveWebSources,
} from "@/lib/message-artifacts/resolve-source-artifacts";
import { cn } from "@/lib/utils";

type CompactSourcesRowProps = {
  artifact: MessageArtifact;
  kind: "web" | "knowledge";
};

function confidenceDot(confidence?: "high" | "medium" | "low") {
  if (confidence === "high") return "bg-emerald-500";
  if (confidence === "low") return "bg-amber-400";
  return "bg-slate-300";
}

export function CompactSourcesRow({ artifact, kind }: CompactSourcesRowProps) {
  if (kind === "web") {
    const sources = resolveWebSources(artifact);
    if (!sources.length) return null;

    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Sources
        </span>
        {sources.slice(0, 4).map((source) => (
          <a
            key={source.id}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex max-w-[220px] items-center gap-1 rounded-full border border-black/8",
              "bg-white px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-black/[0.03]",
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", confidenceDot(source.confidence))}
            />
            <span className="truncate">{source.domain || source.title}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
          </a>
        ))}
        {sources.length > 4 ? (
          <span className="text-[11px] text-ink-3">+{sources.length - 4} more</span>
        ) : null}
      </div>
    );
  }

  const sources = resolveKnowledgeSources(artifact);
  const confidence = artifact.meta?.knowledgeConfidence;
  const showMemoryChip =
    artifact.meta?.providerId === "workspace_memory" ||
    (typeof confidence === "number" && confidence >= 0.85);

  if (!sources.length && !showMemoryChip) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {showMemoryChip ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
          <Sparkles className="h-3 w-3" />
          From project memory
        </span>
      ) : null}
      {sources.map((source) => (
        <span
          key={source.id}
          className="inline-flex max-w-[240px] items-center gap-1 rounded-full border border-black/8 bg-white px-2 py-0.5 text-[11.5px] text-ink-2"
          title={source.quote}
        >
          <Sparkles className="h-3 w-3 shrink-0 text-accent" />
          <span className="truncate">{source.label}</span>
        </span>
      ))}
    </div>
  );
}
