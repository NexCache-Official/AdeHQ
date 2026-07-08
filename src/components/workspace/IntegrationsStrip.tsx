"use client";

/**
 * Integrations strip — shows third-party services relevant to each business app.
 * External OAuth connectors are not live yet; chips are informational only.
 */

import { INTEGRATION_CATALOG, type IntegrationDef } from "@/lib/integrations/strip-catalog";
import { cn } from "@/lib/utils";
import { Clock, Link2 } from "lucide-react";

function IntegrationChip({ def }: { def: IntegrationDef }) {
  return (
    <div
      title={`${def.name} — coming soon`}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-1 pr-2.5 text-xs font-medium text-ink-2"
    >
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white shadow-sm"
        style={{ backgroundColor: def.color }}
      >
        {def.short}
      </span>
      <span>{def.name}</span>
      <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
        Soon
      </span>
    </div>
  );
}

export function IntegrationsStrip({
  title = "Integrations",
  ids,
}: {
  title?: string;
  ids: string[];
}) {
  const defs = ids.map((id) => INTEGRATION_CATALOG[id]).filter(Boolean);

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-gradient-to-r from-accent-500/[0.06] to-transparent px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Link2 className="h-3.5 w-3.5" />
          </span>
          <span className="text-[13px] font-semibold text-ink">{title}</span>
        </div>
        <span className={cn("flex items-center gap-1 text-[11px] font-medium text-amber-700")}>
          <Clock className="h-3 w-3" />
          Third-party connectors coming soon
        </span>
      </div>
      <p className="border-b border-border/60 px-4 py-2 text-[11px] leading-relaxed text-ink-3">
        AdeHQ apps work out of the box. These integrations will let you sync with tools your team already uses.
      </p>
      <div className="flex flex-wrap gap-1.5 p-3">
        {defs.map((def) => (
          <IntegrationChip key={def.id} def={def} />
        ))}
      </div>
    </div>
  );
}

// Re-export for pages that import the catalog type.
export { INTEGRATION_CATALOG } from "@/lib/integrations/strip-catalog";
export type { IntegrationDef } from "@/lib/integrations/strip-catalog";
