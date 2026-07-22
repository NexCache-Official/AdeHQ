import assert from "node:assert/strict";
import {
  isBriefEditInstruction,
  isInstructionShapedBriefLine,
  shouldSkipBriefMutationForMessage,
} from "../src/lib/hiring/recruiter-intents";
import { applyRoleFocusAnswer } from "../src/lib/hiring/role-focus-answers";
import type { AiEmployeeJobBrief } from "../src/lib/hiring/types";

const sampleBrief: AiEmployeeJobBrief = {
  roleTitle: "Market Research Analyst",
  department: "Research",
  domain: "Competitive intelligence",
  mission: "Help the team with competitive intelligence.",
  seniorityLevel: "specialist",
  autonomyLevel: "balanced",
  coreResponsibilities: [
    "Track competitor moves",
    "Own make it more skilled and more complex in analysis work for the team",
  ],
  technicalFocus: [],
  businessFocus: [
    "Competitive intelligence",
    "Make it more skilled and more complex in analysis",
  ],
  successMetrics: ["Timely research briefs"],
  personalityTraits: ["analytical"],
  approvalRules: ["Cite sources for external-facing research"],
  toolsNeeded: [],
  assumptions: ["Primary focus: make it more skilled and more complex in analysis."],
  openQuestions: [],
};

const edit = "Make it more skilled and more complex in analysis";

assert.equal(isBriefEditInstruction(edit), true);
assert.equal(shouldSkipBriefMutationForMessage(edit), true);
assert.equal(isBriefEditInstruction("competitive intelligence"), false);
assert.equal(isBriefEditInstruction("make it more senior"), false);

const focus = applyRoleFocusAnswer(edit, sampleBrief, "market_research_analyst");
assert.equal(focus, null, "brief edits must not append Own {instruction} bullets");

assert.equal(
  isInstructionShapedBriefLine(
    "Own make it more skilled and more complex in analysis work for the team",
  ),
  true,
);
assert.equal(isInstructionShapedBriefLine("Track competitor moves"), false);

console.log("brief edit instruction guards: ok");
