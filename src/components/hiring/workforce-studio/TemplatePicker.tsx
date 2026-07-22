"use client";

import { Users2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui";
import type { TemplateSummary } from "@/lib/hiring/workforce-studio/client-api";

export function TemplatePicker({
  templates,
  onPick,
}: {
  templates: TemplateSummary[];
  onPick: (template: TemplateSummary) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[880px]">
      <div className="mb-8 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3 shadow-sm">
          <Sparkles className="h-3 w-3 text-accent" />
          Maya Workforce Studio
        </div>
        <h1 className="mb-3 text-[38px] font-semibold leading-[1.05] tracking-[-1.4px] text-ink">
          Design your team<span className="text-accent">.</span>
        </h1>
        <p className="mx-auto max-w-[560px] text-[16px] leading-relaxed text-ink-2">
          Pick a starting shape. Maya composes seats, rooms, and collaboration rules — you review, simulate, and
          approve before anything is hired.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {templates.map((template) => (
          <button key={template.key} type="button" onClick={() => onPick(template)} className="text-left">
            <Card hover className="flex h-full flex-col gap-3 p-5 transition hover:border-accent/40">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent-d">
                  <Users2 className="h-4.5 w-4.5" />
                </div>
                <div className="font-semibold text-ink">{template.name}</div>
              </div>
              <p className="text-[13px] leading-relaxed text-ink-2">{template.description}</p>
              <div className="mt-auto flex items-center gap-2 text-[11px] text-ink-3">
                <span>{template.baseSeatCount} base seat{template.baseSeatCount === 1 ? "" : "s"}</span>
                <span aria-hidden>·</span>
                <span>Scales with {template.scalingRuleCount} rule{template.scalingRuleCount === 1 ? "" : "s"}</span>
              </div>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}
