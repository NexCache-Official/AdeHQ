// Client-safe helpers for clarify UX (no AI SDK / server imports).

import type { ClarificationQuestion } from "./diagnosis-types";

const SPECIFY_OPTION_RE = /\b(specify|other|mix|custom|describe|write.?in)\b/i;

/** Options like "Mix (specify)" must collect free text even if allowFreeText was omitted. */
export function clarificationNeedsFreeText(
  question: ClarificationQuestion,
  optionId?: string | null,
): boolean {
  if (question.allowFreeText && !optionId) return true;
  if (!optionId) return false;
  const option = question.options.find((o) => o.id === optionId);
  if (!option) return Boolean(question.allowFreeText);
  if (SPECIFY_OPTION_RE.test(option.label) || SPECIFY_OPTION_RE.test(option.id)) return true;
  // When the question allows free text generally, Mix-style selection still needs a box;
  // plain chip answers do not require typed text.
  return false;
}

export function enrichClarificationQuestions(
  questions: ClarificationQuestion[],
): ClarificationQuestion[] {
  return questions.map((q) => {
    const needsText = q.options.some(
      (o) => SPECIFY_OPTION_RE.test(o.label) || SPECIFY_OPTION_RE.test(o.id),
    );
    return needsText ? { ...q, allowFreeText: true } : q;
  });
}
