import assert from "node:assert/strict";
import { normalizeRecruiterAnswer } from "../src/lib/hiring/normalize-recruiter-answer";
import {
  extractExamplesFromRecruiterMessage,
  extractOptionListBeforeQuestion,
  fallbackRecruiterSuggestionChips,
  inferQuestionTopicFromRecruiterMessage,
  isAssistantVoiceChip,
  parseRecruiterSuggestionChips,
} from "../src/lib/hiring/suggestion-chips";

assert.equal(normalizeRecruiterAnswer("Or cross-functional workflows"), "Cross-functional workflows");
assert.equal(normalizeRecruiterAnswer("and product"), "Product");

const analystQuestion =
  "Let's bring on a Business Analyst. What should they analyze — operations, product, finance, or cross-functional workflows?";

const analystOptions = extractOptionListBeforeQuestion(analystQuestion);
assert.ok(
  analystOptions.some((x) => x === "Cross-functional workflows"),
  `expected clean last option, got ${analystOptions.join("|")}`,
);
assert.ok(
  !analystOptions.some((x) => /^or /i.test(x)),
  `options should not start with Or: ${analystOptions.join("|")}`,
);

const analystChips = parseRecruiterSuggestionChips([{ role: "ade", text: analystQuestion }]);
assert.ok(
  analystChips.some((chip) => chip.label === "Cross-functional workflows"),
  `expected normalized chip, got ${analystChips.map((c) => c.label).join(", ")}`,
);

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

const stackChips = parseRecruiterSuggestionChips(
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

const socialOpening =
  "Let's bring on a Social Media Manager. Which channels — LinkedIn, X, Instagram, TikTok, or multiple?";

const socialChips = parseRecruiterSuggestionChips(
  [{ role: "ade", text: socialOpening }],
  "social_media_manager",
);

assert.ok(
  socialChips.some((chip) => /linkedin|instagram|tiktok|multiple/i.test(chip.label)),
  `expected social channel chips, got ${socialChips.map((c) => c.label).join(", ")}`,
);
assert.ok(
  !socialChips.some((chip) => /react|node\.js|tech stack|frontend and backend/i.test(chip.label)),
  `should not show engineering chips for social media: ${socialChips.map((c) => c.label).join(", ")}`,
);

const briefClosing =
  "Here's the brief I've drafted. Take a look and let me know if you want to tweak anything — or if it's good to go, I can start the hiring process.";

assert.ok(isAssistantVoiceChip("I can start the hiring process"));
assert.ok(isAssistantVoiceChip("if it's good to go"));

const closingChips = parseRecruiterSuggestionChips([{ role: "ade", text: briefClosing }]);
assert.ok(
  !closingChips.some((chip) => /if it's good to go|i can start the hiring process/i.test(chip.label)),
  `should not copy Maya closing prose into chips: ${closingChips.map((c) => c.label).join(", ")}`,
);

const readyFallback = fallbackRecruiterSuggestionChips({
  conversation: [{ role: "ade", text: briefClosing }],
  roleKey: "business_analyst",
  readiness: { ready: true, score: 0.82, missing: [], confidence: "high", reason: "Brief ready" } as import("../src/lib/hiring/types").RecruiterReadiness,
  brief: { roleTitle: "Business Analyst", department: "Operations" } as import("../src/lib/hiring/types").AiEmployeeJobBrief,
  canReviewBrief: true,
});

assert.ok(
  readyFallback.some((chip) => /looks good|start hiring/i.test(chip.label)),
  `expected user-facing approval chip, got ${readyFallback.map((c) => c.label).join(", ")}`,
);
assert.ok(
  !readyFallback.some((chip) => isAssistantVoiceChip(chip.label)),
  `ready fallback should not include assistant-voice chips: ${readyFallback.map((c) => c.label).join(", ")}`,
);

console.log("suggestion-chips: ok");
