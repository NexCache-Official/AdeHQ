"use client";

import { useEffect, useState } from "react";
import { ArrowRight, LayoutTemplate, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { AdeOrb } from "@/components/hiring/HireChrome";
import { MAYA_EMPLOYEE_NAME, MAYA_EMPLOYEE_TITLE } from "@/lib/hiring/maya";

const SUGGESTIONS = [
  "I run a Shopify store selling gym accessories. ~300 orders a month. I handle support, ads, suppliers and content myself.",
  "We are a small accounting firm with three partners. Proposal writing and client follow-ups eat most of our week.",
  "Family restaurant, one location, dine-in + delivery. I need help with reservations, reviews and weekly promotions.",
];

const DIAGNOSE_STEPS = [
  "Reading your description…",
  "Mapping customers, channels, and recurring work…",
  "Identifying bottlenecks and the first team shape…",
];

export function BusinessEntryPanel({
  busy,
  diagnoseStatus,
  onDiagnose,
  onBrowseStartingPoints,
  onStartBlank,
}: {
  busy: boolean;
  diagnoseStatus?: string | null;
  onDiagnose: (description: string, websiteUrl: string) => void;
  onBrowseStartingPoints: () => void;
  onStartBlank: () => void;
}) {
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!busy) {
      setStepIndex(0);
      return;
    }
    const id = window.setInterval(() => {
      setStepIndex((i) => (i + 1) % DIAGNOSE_STEPS.length);
    }, 4500);
    return () => window.clearInterval(id);
  }, [busy]);

  const statusLabel = diagnoseStatus?.trim() || DIAGNOSE_STEPS[stepIndex];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section className="studio-fade-up rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <AdeOrb size={36} initials="M" />
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
              {MAYA_EMPLOYEE_NAME} · Workforce Studio
            </p>
            <p className="text-[12px] text-ink-3">{MAYA_EMPLOYEE_TITLE}</p>
          </div>
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight text-ink sm:text-[32px]">
          What are you building or running?
        </h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-2">
          Tell {MAYA_EMPLOYEE_NAME} about your business in your own words. She&apos;ll identify the
          work, bottlenecks, departments, and team you need — nothing is hired until you review and
          approve.
        </p>

        <label className="mt-6 block">
          <span className="sr-only">Business description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={7}
            placeholder="Describe what you sell, who your customers are, what your team struggles with, and what you want to improve…"
            className="input-field min-h-[160px] resize-y text-[14px] leading-relaxed"
            disabled={busy}
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-3">
            Website (optional)
          </span>
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://"
            className="input-field"
            disabled={busy}
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.slice(0, 24)}
              type="button"
              disabled={busy}
              onClick={() => setDescription(suggestion)}
              className="rounded-full border border-border bg-canvas px-3 py-1.5 text-left text-[11px] text-ink-2 hover:border-accent/40 hover:text-ink"
            >
              {suggestion.length > 72 ? `${suggestion.slice(0, 72)}…` : suggestion}
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            onClick={() => onDiagnose(description.trim(), websiteUrl.trim())}
            disabled={busy || description.trim().length < 20}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Let {MAYA_EMPLOYEE_NAME} design my workforce
          </Button>
          <button
            type="button"
            onClick={onBrowseStartingPoints}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            Browse proven team systems
          </button>
          <button
            type="button"
            onClick={onStartBlank}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"
          >
            Start from a blank team
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {busy ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-border bg-canvas px-3 py-2.5 text-[13px] text-ink-2">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
            <span>{statusLabel}</span>
            <span className="text-ink-3">This can take up to a minute.</span>
          </div>
        ) : null}
      </section>

      <aside className="rounded-2xl border border-border bg-canvas p-6 sm:p-8">
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Preview</p>
        <h2 className="mt-2 text-lg font-semibold text-ink">How {MAYA_EMPLOYEE_NAME} builds your team</h2>
        <ol className="mt-6 space-y-4 text-[13px] text-ink-2">
          <li className="rounded-xl border border-border bg-surface px-4 py-3">
            <span className="font-medium text-ink">1. Your business</span>
            <p className="mt-1 text-ink-3">Customers, channels, recurring work, bottlenecks.</p>
          </li>
          <li className="rounded-xl border border-border bg-surface px-4 py-3">
            <span className="font-medium text-ink">2. Role briefs</span>
            <p className="mt-1 text-ink-3">
              Missions, responsibilities, and outcomes for each AI seat — review before hiring.
            </p>
          </li>
          <li className="rounded-xl border border-border bg-surface px-4 py-3">
            <span className="font-medium text-ink">3. Hire your way</span>
            <p className="mt-1 text-ink-3">
              Preview candidates, keep or drop seats, simulate a week, then approve.
            </p>
          </li>
        </ol>
        <p className="mt-6 text-[12px] leading-relaxed text-ink-3">
          Importing an existing team and rich document uploads arrive in a later release. Starting
          points remain available if you prefer a known template.
        </p>
      </aside>
    </div>
  );
}
