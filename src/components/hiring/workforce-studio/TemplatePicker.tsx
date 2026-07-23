"use client";

import { Users2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui";
import type { TemplateSummary } from "@/lib/hiring/workforce-studio/client-api";

const CATEGORY_ORDER = [
  "commerce",
  "hospitality",
  "professional",
  "technology",
  "education_media",
  "operational",
] as const;

const CATEGORY_LABEL: Record<(typeof CATEGORY_ORDER)[number], string> = {
  commerce: "Commerce",
  hospitality: "Hospitality & local",
  professional: "Professional services",
  technology: "Technology",
  education_media: "Education & media",
  operational: "Operational teams",
};

function categoryOf(template: TemplateSummary): (typeof CATEGORY_ORDER)[number] {
  const raw = (template.category ?? "operational") as (typeof CATEGORY_ORDER)[number];
  return CATEGORY_ORDER.includes(raw) ? raw : "operational";
}

export function TemplatePicker({
  templates,
  onPick,
}: {
  templates: TemplateSummary[];
  onPick: (template: TemplateSummary) => void;
}) {
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: templates.filter((t) => categoryOf(t) === category),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto w-full max-w-[960px]">
      <div className="mb-8 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3 shadow-sm">
          <Sparkles className="h-3 w-3 text-accent" />
          Starting points
        </div>
        <h1 className="mb-3 text-[32px] font-semibold leading-[1.05] tracking-[-1.2px] text-ink">
          Browse proven team systems<span className="text-accent">.</span>
        </h1>
        <p className="mx-auto max-w-[560px] text-[15px] leading-relaxed text-ink-2">
          These packs are assembled from shared modules — pick one as a starting shape, then review and simulate
          before anything is hired.
        </p>
      </div>

      <div className="space-y-8">
        {grouped.map(({ category, items }) => (
          <section key={category}>
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-ink-3">
              {CATEGORY_LABEL[category]}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((template) => (
                <button key={template.key} type="button" onClick={() => onPick(template)} className="text-left">
                  <Card hover className="flex h-full flex-col gap-3 p-5 transition hover:border-accent/40">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent-d">
                        <Users2 className="h-4.5 w-4.5" />
                      </div>
                      <div className="min-w-0 truncate font-semibold text-ink">{template.name}</div>
                    </div>
                    <p className="text-[13px] leading-relaxed text-ink-2">{template.description}</p>
                    <div className="mt-auto text-[11px] text-ink-3">
                      {template.baseSeatCount} base seat{template.baseSeatCount === 1 ? "" : "s"}
                    </div>
                  </Card>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
