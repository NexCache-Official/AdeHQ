"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { AdeOrb } from "@/components/hiring/HireChrome";
import { MAYA_EMPLOYEE_NAME } from "@/lib/hiring/maya";
import { cn } from "@/lib/utils";
import type { ClarificationQuestion } from "@/lib/hiring/workforce-studio/diagnosis-types";
import { clarificationNeedsFreeText } from "@/lib/hiring/workforce-studio/clarification-ui";

export function ClarifyChatPanel({
  question,
  askedCount,
  remainingEstimate,
  busy,
  canGoBack,
  onAnswer,
  onBack,
}: {
  question: ClarificationQuestion;
  askedCount: number;
  remainingEstimate: number;
  busy: boolean;
  canGoBack?: boolean;
  onAnswer: (optionId: string, freeText?: string) => void;
  onBack?: () => void;
}) {
  const [freeText, setFreeText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setFreeText("");
    setSelected(null);
  }, [question.id]);

  const needsFreeText = useMemo(
    () => clarificationNeedsFreeText(question, selected),
    [question, selected],
  );

  const canContinue =
    Boolean(selected || freeText.trim()) &&
    (!needsFreeText || Boolean(freeText.trim()));

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-start gap-3">
        <AdeOrb size={36} initials="M" />
        <div className="min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">
            {MAYA_EMPLOYEE_NAME}
          </p>
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
        {needsFreeText ? (
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={2}
            placeholder="Tell Maya what that mix looks like…"
            className="input-field mt-2"
            disabled={busy}
            autoFocus
          />
        ) : question.allowFreeText ? (
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
        <div className="flex items-center gap-3">
          {canGoBack && onBack ? (
            <button
              type="button"
              disabled={busy}
              onClick={onBack}
              className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          ) : null}
          <p className="text-[12px] text-ink-3">
            Question {askedCount + 1}
            {remainingEstimate > 0 ? ` · about ${remainingEstimate} more` : ""}
          </p>
        </div>
        <Button
          disabled={busy || !canContinue}
          onClick={() =>
            onAnswer(selected ?? "free_text", freeText.trim() || undefined)
          }
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue
        </Button>
      </div>
    </div>
  );
}
