/**
 * Regression check: the "generic" recruiter questions (quality preference,
 * approval rules) must not use software/shipping language for non-engineering
 * roles, and must still parse into clean multi-option chips.
 *
 * Run: npm run test:hiring:role-questions
 */
import assert from "node:assert";
import {
  chooseNextRecruiterQuestion,
  parseRecruiterSuggestionChips,
} from "../src/lib/hiring/recruiter-brain";
import type { AiEmployeeJobBrief, RecruiterMessage, RecruiterReadiness } from "../src/lib/hiring/types";
import { getRoleByKey } from "../src/lib/hiring/role-library";

function baseBrief(overrides: Partial<AiEmployeeJobBrief> = {}): AiEmployeeJobBrief {
  return {
    roleTitle: "Market Research Analyst",
    department: "Market & competitive research",
    domain: "Competitive intelligence",
    mission: "",
    coreResponsibilities: ["Monitor competitors", "Produce research briefs"],
    successMetrics: [],
    businessFocus: ["Competitive intelligence"],
    technicalFocus: [],
    toolsNeeded: [],
    approvalRules: [],
    communicationStyle: "",
    personalityTraits: [],
    proactivityLevel: "balanced",
    qualityPreference: "",
    seniorityLevel: "specialist",
    autonomyLevel: "balanced",
    assumptions: [],
    openQuestions: [],
    ...overrides,
  } as AiEmployeeJobBrief;
}

function readinessMissing(fields: RecruiterReadiness["missing"]): RecruiterReadiness {
  return { score: 50, ready: false, confidence: "medium", missing: fields, reason: "" };
}

function run() {
  const marketResearchBrief = baseBrief();
  const conversation: RecruiterMessage[] = [
    { role: "user", text: "I need a market research analyst focused on competitors." },
  ];

  // 1. Quality preference must not say "shipping" for a research role.
  const qualityQuestion = chooseNextRecruiterQuestion(
    readinessMissing(["quality_preference"]),
    marketResearchBrief,
    "market_research_analyst",
    conversation,
  );
  assert.ok(
    !/shipping/i.test(qualityQuestion),
    `Research role quality question should not mention shipping, got: "${qualityQuestion}"`,
  );
  assert.match(qualityQuestion, /\?$/, "Question must end with a question mark");
  console.log("quality question (research):", qualityQuestion);

  // 2. That question must still parse into 3 clean chips (no "They bias toward X" artifact).
  const chipConversation: RecruiterMessage[] = [...conversation, { role: "ade", text: qualityQuestion }];
  const chips = parseRecruiterSuggestionChips(chipConversation, "market_research_analyst");
  const answerChips = chips.filter((chip) => chip.intent === "answer_question" && chip.label !== "Not sure — help me decide");
  assert.ok(answerChips.length >= 3, `Expected >=3 answer chips, got ${JSON.stringify(chips)}`);
  for (const chip of answerChips) {
    assert.ok(
      !/^they\b/i.test(chip.label),
      `Chip label should not start with "They" (regex artifact), got: "${chip.label}"`,
    );
  }
  console.log("quality chips (research):", answerChips.map((c) => c.label));

  // 3. Engineering roles keep the original shipping-flavored wording.
  const engineeringQuestion = chooseNextRecruiterQuestion(
    readinessMissing(["quality_preference"]),
    baseBrief({ roleTitle: "Software Engineer", department: "Engineering" }),
    "software_engineer",
    [{ role: "user", text: "I need a software engineer." }],
  );
  assert.match(engineeringQuestion, /shipping/i, "Engineering role should keep shipping language");
  console.log("quality question (engineering):", engineeringQuestion);

  // 4. Approval rules for a legal-flavored role should not talk about "publishing" content.
  const legalBrief = baseBrief({ roleTitle: "Contracts Specialist", department: "Corporate legal & compliance", domain: "Contract review" });
  const legalQuestion = chooseNextRecruiterQuestion(
    readinessMissing(["approval_rules"]),
    legalBrief,
    "custom",
    [{ role: "user", text: "I need a contracts specialist to review vendor contracts." }],
  );
  assert.match(legalQuestion, /run by you first/i);
  console.log("approval question (legal-flavored custom role):", legalQuestion);

  // 5. Sanity: role library entries still resolve (no typo in roleKey used above).
  assert.ok(getRoleByKey("market_research_analyst"), "market_research_analyst should exist in role library");
  assert.ok(getRoleByKey("software_engineer"), "software_engineer should exist in role library");

  console.log("role-aware recruiter questions: ok");
}

run();
