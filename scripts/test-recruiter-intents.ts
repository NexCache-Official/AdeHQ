import assert from "node:assert/strict";
import {
  detectRecruiterUserIntent,
  mayaReplyForRecruiterIntent,
  shouldSkipBriefUpdateIntent,
} from "../src/lib/hiring/recruiter-intents";

function testIntent(input: string, expected: ReturnType<typeof detectRecruiterUserIntent>) {
  const got = detectRecruiterUserIntent(input);
  assert.equal(got, expected, `Expected "${input}" -> ${expected}, got ${got}`);
}

testIntent("im happy, shortlist candidates", "generate_candidates");
testIntent("I'm happy with the brief", "approve_brief");
testIntent("Review job brief", "review_brief");
testIntent("React", "gathering");
testIntent("change the mission to focus on growth", "gathering");

assert.equal(shouldSkipBriefUpdateIntent("generate_candidates"), true);
assert.equal(shouldSkipBriefUpdateIntent("gathering"), false);
assert.ok(mayaReplyForRecruiterIntent("generate_candidates")?.includes("shortlist"));

console.log("recruiter-intents: ok");
