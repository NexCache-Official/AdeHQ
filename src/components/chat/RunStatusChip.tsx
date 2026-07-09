"use client";

import type { RunStatusChip as RunStatusChipType } from "@/lib/ai/intelligence/adaptive-timing";
import { statusChipLabel } from "@/lib/ai/intelligence/adaptive-timing";
import { cn } from "@/lib/utils";

export function RunStatusChip({
  chip,
  className,
}: {
  chip: RunStatusChipType;
  className?: string;
}) {
  const tone =
    chip === "from_cache"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : chip === "searching" || chip === "research_report"
        ? "border-sky-200 bg-sky-50 text-sky-800"
        : "border-border bg-surface text-ink-3";

  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11.5px] font-medium",
        tone,
        className,
      )}
    >
      {statusChipLabel(chip)}
    </span>
  );
}
