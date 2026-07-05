"use client";

import { useOptionalMayaDmHiringContext } from "@/components/maya/MayaDmHiringContext";
import { isProceedToBriefAction } from "@/lib/hiring/recruiter-intents";
import type { RecruiterSuggestionChip } from "@/lib/hiring/types";
import { cn } from "@/lib/utils";

type MayaHiringSuggestionChipsProps = {
  className?: string;
};

function handleChip(
  chip: RecruiterSuggestionChip,
  hiring: NonNullable<ReturnType<typeof useOptionalMayaDmHiringContext>>,
) {
  if (
    chip.intent === "review_brief" ||
    isProceedToBriefAction(chip.value) ||
    isProceedToBriefAction(chip.label)
  ) {
    hiring.goToBriefReview();
    return;
  }
  if (chip.intent === "generate_candidates") {
    void hiring.generateCandidates();
    return;
  }
  void hiring.sendUserMessage(
    chip.value,
    chip.intent === "draft_brief_now" ? "draft_now" : "message",
  );
}

export function MayaHiringSuggestionChips({ className }: MayaHiringSuggestionChipsProps) {
  const hiring = useOptionalMayaDmHiringContext();
  if (!hiring || hiring.session.busy || hiring.generatingCandidates) return null;

  const chips = hiring.extraChips.filter((chip) => chip.intent !== "review_brief");
  if (chips.length === 0) return null;

  return (
    <div className={cn("mb-2 flex flex-wrap gap-2", className)}>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          disabled={hiring.session.busy}
          onClick={() => handleChip(chip, hiring)}
          className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-accent-200 hover:bg-accent-50 hover:text-accent-800 disabled:opacity-50"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
