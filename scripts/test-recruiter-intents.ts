import assert from "node:assert/strict";
import {
  detectRecruiterUserIntent,
  isProceedToBriefAction,
  mayaReplyForRecruiterIntent,
  shouldSkipBriefMutationForMessage,
  shouldSkipBriefUpdateIntent,
} from "../src/lib/hiring/recruiter-intents";
import { applyRoleFocusAnswer } from "../src/lib/hiring/role-focus-answers";

function testIntent(input: string, expected: ReturnType<typeof detectRecruiterUserIntent>) {
  const got = detectRecruiterUserIntent(input);
  assert.equal(got, expected, `Expected "${input}" -> ${expected}, got ${got}`);
}

testIntent("im happy, shortlist candidates", "generate_candidates");
testIntent("I'm happy with the brief", "approve_brief");
testIntent("Review job brief", "review_brief");
testIntent("Go ahead and hire", "review_brief");
testIntent("go ahead and hire", "review_brief");
testIntent("Jump straight to hiring", "review_brief");
testIntent("Want to review the full brief", "review_brief");
testIntent("React", "gathering");
testIntent("change the mission to focus on growth", "gathering");

assert.equal(isProceedToBriefAction("Jump straight to hiring"), true);
assert.equal(shouldSkipBriefMutationForMessage("Tweak anything else"), true);
assert.equal(shouldSkipBriefMutationForMessage("Cross-functional workflows"), false);
assert.equal(shouldSkipBriefUpdateIntent("generate_candidates"), true);
assert.equal(shouldSkipBriefUpdateIntent("gathering"), false);
assert.ok(mayaReplyForRecruiterIntent("generate_candidates")?.includes("shortlist"));

const brief = {
  roleTitle: "Business Analyst",
  department: "Operations",
  domain: "Operations",
  mission: "Help the team.",
  coreResponsibilities: ["Analyze workflows"],
  technicalFocus: [],
  businessFocus: ["Cross-functional workflows"],
  successMetrics: [],
  personalityTraits: [],
  approvalRules: [],
  toolsNeeded: [],
  assumptions: [],
  openQuestions: [],
  seniorityLevel: "specialist" as const,
  autonomyLevel: "balanced" as const,
  communicationStyle: "Professional",
  qualityPreference: "balanced" as const,
  proactivityLevel: "balanced" as const,
};
assert.equal(
  applyRoleFocusAnswer("Jump straight to hiring", brief, "business_analyst"),
  null,
  "proceed phrases must not mutate brief",
);

console.log("recruiter-intents: ok");
