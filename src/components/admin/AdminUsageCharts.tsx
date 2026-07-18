"use client";

import { cn } from "@/lib/utils";
import type { UsageDayPoint } from "@/lib/admin/queries/usage";

/** Simple dual-series SVG bar chart for admin Usage (no chart library). */
export function AdminCostOverTimeChart({
  series,
  className,
}: {
  series: UsageDayPoint[];
  className?: string;
}) {
  if (!series.length) {
    return (
      <div className={cn("flex h-40 items-center justify-center text-sm text-ink-3", className)}>
        No daily usage in this range.
      </div>
    );
  }

  const max = Math.max(...series.map((d) => Math.max(d.costUsd, d.mayaCostUsd + d.hiredCostUsd)), 0.0001);
  const width = 640;
  const height = 160;
  const padX = 28;
  const padY = 16;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const gap = Math.min(8, innerW / series.length / 4);
  const barW = Math.max(4, innerW / series.length - gap);

  return (
    <div className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label="Cost over time">
        {series.map((d, i) => {
          const x = padX + i * (barW + gap);
          const hiredH = (d.hiredCostUsd / max) * innerH;
          const mayaH = (d.mayaCostUsd / max) * innerH;
          const baseY = padY + innerH;
          return (
            <g key={d.day}>
              <title>
                {d.day}: total {d.costUsd.toFixed(4)} · hired {d.hiredCostUsd.toFixed(4)} · maya{" "}
                {d.mayaCostUsd.toFixed(4)}
              </title>
              <rect
                x={x}
                y={baseY - hiredH}
                width={barW}
                height={Math.max(hiredH, 0)}
                className="fill-accent/70"
                rx={2}
              />
              <rect
                x={x}
                y={baseY - hiredH - mayaH}
                width={barW}
                height={Math.max(mayaH, 0)}
                className="fill-sky-500/70"
                rx={2}
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-accent/70" /> Hired
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-sky-500/70" /> Maya
        </span>
        <span className="ml-auto tabular-nums">
          {series[0]?.day} → {series[series.length - 1]?.day}
        </span>
      </div>
    </div>
  );
}

export function AdminHorizontalBars({
  rows,
  className,
}: {
  rows: Array<{ key: string; label: string; value: number }>;
  className?: string;
}) {
  if (!rows.length) {
    return (
      <div className={cn("py-6 text-center text-sm text-ink-3", className)}>No data.</div>
    );
  }
  const max = Math.max(...rows.map((r) => r.value), 0.0001);
  return (
    <div className={cn("space-y-2", className)}>
      {rows.slice(0, 8).map((row) => (
        <div key={row.key} className="min-w-0">
          <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate text-ink-2">{row.label}</span>
            <span className="shrink-0 tabular-nums text-ink-3">${row.value.toFixed(4)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
