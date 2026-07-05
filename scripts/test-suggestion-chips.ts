import assert from "node:assert/strict";
import {
  extractExamplesFromRecruiterMessage,
  extractOptionListBeforeQuestion,
  generateSuggestionChips,
  inferQuestionTopicFromRecruiterMessage,
} from "../src/lib/hiring/suggestion-chips";
import type { AiEmployeeJobBrief, RecruiterReadiness } from "../src/lib/hiring/types";

const engineeringBrief: AiEmployeeJobBrief = {
  roleTitle: "Software Engineer",
  department: "Engineering",
  domain: "Full-stack development",
  mission: "Ship features",
  coreResponsibilities: ["Build features"],
  technicalFocus: ["Full-stack product engineering"],
  businessFocus: ["Full-stack product engineering"],
  successMetrics: ["Ship on time"],
  communicationStyle: "Technical",
  personalityTraits: ["practical"],
  proactivityLevel: "balanced",
  qualityPreference: "balanced",
  seniorityLevel: "specialist",
  autonomyLevel: "balanced",
  approvalRules: ["Ask before deploys"],
  toolsNeeded: [],
  assumptions: [],
  openQuestions: [],
};

const almostReady: RecruiterReadiness = {
  score: 82,
  ready: false,
  confidence: "medium",
  missing: ["seniority", "autonomy", "tools", "approval_rules"],
  reason: "gathering",
};

const stackQuestion =
  "Got it — full-stack. To narrow down the tech stack, what specific frontend and backend technologies or frameworks does your team use? (e.g., React + Node.js, Vue + Python, etc.)";

assert.equal(inferQuestionTopicFromRecruiterMessage(stackQuestion), "stack");

const stackExamples = extractExamplesFromRecruiterMessage(stackQuestion);
assert.ok(stackExamples.some((x) => /react/i.test(x)), `expected react example, got ${stackExamples.join("|")}`);

const focusQuestion =
  "Good choice. Should this engineer focus on frontend product work, backend systems, full-stack, AI infrastructure, or QA?";

const focusOptions = extractOptionListBeforeQuestion(focusQuestion);
assert.ok(focusOptions.some((x) => /frontend product work/i.test(x)), focusOptions.join("|"));
assert.ok(focusOptions.some((x) => /full-stack/i.test(x)), focusOptions.join("|"));

const stackChips = generateSuggestionChips(
  almostReady,
  engineeringBrief,
  [
    { role: "ade", text: focusQuestion },
    { role: "user", text: "Full-stack" },
    { role: "ade", text: stackQuestion },
  ],
  "software_engineer",
);

assert.ok(
  stackChips.some((chip) => /react|node|next|vue|python|rails/i.test(chip.label)),
  `expected stack chips, got ${stackChips.map((c) => c.label).join(", ")}`,
);
assert.ok(
  !stackChips.some((chip) => /senior advisor|autonomous manager/i.test(chip.label)),
  `should not show seniority chips for stack question: ${stackChips.map((c) => c.label).join(", ")}`,
);

console.log("suggestion-chips: ok");
