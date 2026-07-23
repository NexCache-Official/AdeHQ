"use client";

import { useState } from "react";
import { ArrowRight, LayoutTemplate, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";

const SUGGESTIONS = [
  "I run a Shopify store selling gym accessories. ~300 orders a month. I handle support, ads, suppliers and content myself.",
  "We are a small accounting firm with three partners. Proposal writing and client follow-ups eat most of our week.",
  "Family restaurant, one location, dine-in + delivery. I need help with reservations, reviews and weekly promotions.",
];

export function BusinessEntryPanel({
  busy,
  onDiagnose,
  onBrowseStartingPoints,
  onStartBlank,
}: {
  busy: boolean;
  onDiagnose: (description: string, websiteUrl: string) => void;
  onBrowseStartingPoints: () => void;
  onStartBlank: () => void;
}) {
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section className="studio-fade-up rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Maya Workforce Studio
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight text-ink sm:text-[32px]">
          What are you building or running?
        </h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-2">
          Tell Maya about your business in your own words. She&apos;ll identify the work,
          bottlenecks, departments, and team you need — nothing is hired until you review and
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
            Let Maya design my workforce
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
      </section>

      <aside className="rounded-2xl border border-border bg-canvas p-6 sm:p-8">
        <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Preview</p>
        <h2 className="mt-2 text-lg font-semibold text-ink">How Maya builds your team</h2>
        <ol className="mt-6 space-y-4 text-[13px] text-ink-2">
          <li className="rounded-xl border border-border bg-surface px-4 py-3">
            <span className="font-medium text-ink">1. Your business</span>
            <p className="mt-1 text-ink-3">Customers, channels, recurring work, bottlenecks.</p>
          </li>
          <li className="rounded-xl border border-border bg-surface px-4 py-3">
            <span className="font-medium text-ink">2. Departments</span>
            <p className="mt-1 text-ink-3">Customer work · Operations · Growth · Leadership</p>
          </li>
          <li className="rounded-xl border border-border bg-surface px-4 py-3">
            <span className="font-medium text-ink">3. AI teammates</span>
            <p className="mt-1 text-ink-3">Roles, rooms, collaboration contracts, approvals.</p>
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
