"use client";

import { Sparkles } from "lucide-react";

export function OrchestrationInlineChip({ label }: { label: string }) {
  return (
    <div className="mt-1 flex justify-end">
      <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/80 bg-muted/60 px-2.5 py-0.5 text-[10px] font-medium text-ink-3">
        <Sparkles className="h-3 w-3 shrink-0 text-accent-600/80" />
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}
