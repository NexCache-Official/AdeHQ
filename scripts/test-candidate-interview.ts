/**
 * Candidate interview LLM tests.
 *
 * Usage: npx tsx scripts/test-candidate-interview.ts
 */

import assert from "node:assert/strict";
import {
  fallbackInterviewAnswer,
  interviewQuestionLabel,
} from "../src/lib/hiring/candidate-interview";
import type { AiEmployeeApplicant } from "../src/lib/hiring/types";

function sampleApplicant(overrides: Partial<AiEmployeeApplicant> = {}): AiEmployeeApplicant {
  return {
    id: "cand_test",
    tier: "recommended",
    name: "Jordan Rivera",
    first: "Jordan",
    title: "Cross-Functional Alignment Specialist",
    modelMode: "balanced",
    resolvedModelId: "deepseek-ai/DeepSeek-V3",
    engineLabel: "Balanced Intelligence",
    weeklyWorkHours: 80,
    costIntensity: "medium",
    speed: "standard",
    quality: "high",
    qualityLevel: 2,
    speedLevel: 2,
    costLevel: 2,
    strengths: ["Cross-functional coordination"],
    watchOuts: ["Needs clear priorities"],
    bestFor: "Alignment across teams",
    whyThisCandidate: "Strong fit",
    recommended: true,
    personalityTags: ["collaborative"],
    grad: "linear-gradient(135deg,#6366f1,#3b82f6)",
    badge: "Recommended",
    badgeKind: "rec",
    cap: 0.18,
    ...overrides,
  };
}

assert.equal(
  interviewQuestionLabel("sales"),
  "How would you work with my Sales Employee?",
);

const salesAnswer = fallbackInterviewAnswer(
  sampleApplicant(),
  "How would you work with my Sales Employee?",
);
assert.ok(salesAnswer.length > 40);
assert.ok(!/that's a great question/i.test(salesAnswer));

const genericFallback = fallbackInterviewAnswer(sampleApplicant(), "What tools do you prefer?");
assert.ok(genericFallback.includes("Jordan") || genericFallback.includes("Cross-Functional"));

console.log("candidate-interview: ok");
