"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ClarificationQuestion } from "@/lib/hiring/workforce-studio/diagnosis-types";

export function ClarifyChatPanel({
  question,
  askedCount,
  remainingEstimate,
  busy,
  onAnswer,
}: {
  question: ClarificationQuestion;
  askedCount: number;
  remainingEstimate: number;
  busy: boolean;
  onAnswer: (optionId: string, freeText?: string) => void;
}) {
  const [freeText, setFreeText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Maya</p>
          <p className="mt-1 text-[15px] leading-relaxed text-ink">{question.prompt}</p>
          <p className="mt-2 text-[12px] text-ink-3">{question.whyItMatters}</p>
        </div>
      </div>

      <div className="space-y-2 pl-12">
        {question.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={busy}
            onClick={() => setSelected(option.id)}
            className={cn(
              "block w-full rounded-xl border px-4 py-3 text-left text-[14px] transition",
              selected === option.id
                ? "border-accent bg-accent/10 text-ink"
                : "border-border bg-surface text-ink-2 hover:border-accent/40",
            )}
          >
            {option.label}
          </button>
        ))}
        {question.allowFreeText ? (
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={2}
            placeholder="Or answer in your own words…"
            className="input-field mt-2"
            disabled={busy}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 pl-12">
        <p className="text-[12px] text-ink-3">
          Question {askedCount + 1}
          {remainingEstimate > 0 ? ` · about ${remainingEstimate} more` : ""}
        </p>
        <Button
          disabled={busy || (!selected && !freeText.trim())}
          onClick={() => onAnswer(selected ?? "free_text", freeText.trim() || undefined)}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue
        </Button>
      </div>
    </div>
  );
}
