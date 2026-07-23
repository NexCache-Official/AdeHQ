// PR-22A — progressive clarification. Picks the next unanswered diagnosis
// question or stops when confidence is high enough / the cap is reached.

import type {
  BusinessOperatingDiagnosis,
  ClarificationAnswer,
  ClarificationQuestion,
} from "./diagnosis-types";

export const MAX_CLARIFY_QUESTIONS = 5;
export const CONFIDENCE_STOP_THRESHOLD = 0.75;

export type NextQuestionResult =
  | {
      done: false;
      question: ClarificationQuestion;
      askedCount: number;
      remainingEstimate: number;
    }
  | {
      done: true;
      confidence: number;
      askedCount: number;
      reason: "confidence" | "exhausted" | "cap";
    };

function answeredIds(answers: ClarificationAnswer[]): Set<string> {
  return new Set(answers.map((a) => a.questionId));
}

/** Apply answers that boost confidence (deterministic, no LLM). */
export function confidenceAfterAnswers(
  diagnosis: BusinessOperatingDiagnosis,
  answers: ClarificationAnswer[],
): number {
  let confidence = diagnosis.confidence;
  // Each answered clarification gives Maya a bit more certainty, capped at 0.95.
  confidence = Math.min(0.95, confidence + answers.length * 0.08);
  const pain = answers.find((a) => a.questionId === "q_biggest_pain" || a.questionId.includes("pain"));
  if (pain?.optionId) confidence = Math.min(0.95, confidence + 0.05);
  const size = answers.find((a) => a.questionId.includes("team_size") || a.questionId.includes("size"));
  if (size?.optionId) confidence = Math.min(0.95, confidence + 0.05);
  return confidence;
}

export function selectNextClarificationQuestion(
  diagnosis: BusinessOperatingDiagnosis,
  answers: ClarificationAnswer[],
): NextQuestionResult {
  const asked = answeredIds(answers);
  const confidence = confidenceAfterAnswers(diagnosis, answers);
  const queue = diagnosis.clarificationQuestions.slice(0, MAX_CLARIFY_QUESTIONS);
  const next = queue.find((q) => !asked.has(q.id));
  const askedCount = asked.size;

  if (!next) {
    return {
      done: true,
      confidence,
      askedCount,
      reason: askedCount >= queue.length ? "exhausted" : "cap",
    };
  }

  if (askedCount > 0 && confidence >= CONFIDENCE_STOP_THRESHOLD && askedCount >= 2) {
    return { done: true, confidence, askedCount, reason: "confidence" };
  }

  if (askedCount >= MAX_CLARIFY_QUESTIONS) {
    return { done: true, confidence, askedCount, reason: "cap" };
  }

  return {
    done: false,
    question: next,
    askedCount,
    remainingEstimate: Math.max(0, Math.min(MAX_CLARIFY_QUESTIONS, queue.length) - askedCount - 1),
  };
}

/** Merge chip/free-text answers into a lookup for the template mapper. */
export function answersToLookup(answers: ClarificationAnswer[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const answer of answers) {
    out[answer.questionId] = (answer.optionId ?? answer.freeText ?? "").trim();
  }
  return out;
}
