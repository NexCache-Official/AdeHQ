/**
 * Honesty guardrail tests — the reconcileClaimedActions guard rewrites replies
 * that claim completed tool-backed actions when nothing actually persisted.
 *
 * Usage: npm run test:claimed-actions-guardrail
 */

import {
  reconcileClaimedActions,
  replyClaimsCompletedAction,
  type PersistedActionCounts,
} from "../src/lib/integrations/reconcile-claimed-actions";

function expectTrue(condition: boolean, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

function test(name: string, run: () => void) {
  try {
    run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

const NOTHING: PersistedActionCounts = {
  toolSuccessCount: 0,
  toolPendingCount: 0,
  toolFailureCount: 0,
  emailDraftCount: 0,
  taskCount: 0,
  artifactCount: 0,
  approvalCount: 0,
  memoryCount: 0,
};

const REAL_CRM_CLAIM =
  "Done. Created GreenEdge Robotics in CRM, added Praveen as contact, logged a £5,000 qualified deal, drafted an outreach email, set a follow-up task for Friday, and generated a spreadsheet summary.";

function main() {
  test("detects the exact false-completion reply from the bug report", () => {
    expectTrue(replyClaimsCompletedAction(REAL_CRM_CLAIM));
  });

  test("false claim with zero effects is rewritten + gets a notice chip", () => {
    const result = reconcileClaimedActions(REAL_CRM_CLAIM, NOTHING, {
      triggerMessageId: "msg_1",
    });
    expectTrue(result.falseClaim, "expected false claim");
    expectTrue(result.reply !== REAL_CRM_CLAIM, "reply should be rewritten");
    expectTrue(/try again/i.test(result.reply), "honest reply should offer retry");
    expectTrue(result.notice?.type === "tool_result", "expected notice chip");
    expectTrue(result.notice?.meta?.toolStatus === "failed", "notice should be failed");
  });

  test("claim backed by a successful tool call passes through unchanged", () => {
    const result = reconcileClaimedActions(REAL_CRM_CLAIM, {
      ...NOTHING,
      toolSuccessCount: 3,
    });
    expectTrue(!result.falseClaim, "should not flag when tools succeeded");
    expectTrue(result.reply === REAL_CRM_CLAIM, "reply unchanged");
    expectTrue(result.notice === undefined, "no notice");
  });

  test("partial tool failure appends an honest caveat", () => {
    const result = reconcileClaimedActions(REAL_CRM_CLAIM, {
      ...NOTHING,
      toolSuccessCount: 2,
      toolFailureCount: 1,
    });
    expectTrue(result.falseClaim, "partial completion claim should be adjusted");
    expectTrue(/Some actions failed/i.test(result.reply), "reply should mention partial failure");
    expectTrue(result.notice === undefined, "cards already show individual failures");
  });

  test("claim backed by a created task passes through", () => {
    const result = reconcileClaimedActions("Added a follow-up task for Friday.", {
      ...NOTHING,
      taskCount: 1,
    });
    expectTrue(!result.falseClaim);
  });

  test("claim backed by an email draft artifact passes through", () => {
    const result = reconcileClaimedActions("Drafted the outreach email for you.", {
      ...NOTHING,
      artifactCount: 1,
    });
    expectTrue(!result.falseClaim);
  });

  test("tool failure suppresses duplicate notice but still rewrites reply", () => {
    const result = reconcileClaimedActions(REAL_CRM_CLAIM, {
      ...NOTHING,
      toolFailureCount: 2,
    });
    expectTrue(result.falseClaim, "still a false 'created' claim");
    expectTrue(result.notice === undefined, "failure chips already shown — no duplicate notice");
    expectTrue(result.reply !== REAL_CRM_CLAIM, "reply corrected");
  });

  test("approval-pending (preview) counts as real work — no rewrite", () => {
    const result = reconcileClaimedActions(
      "Prepared the deal for your approval.",
      { ...NOTHING, toolPendingCount: 1 },
    );
    expectTrue(!result.falseClaim);
  });

  test("future-tense intent is NOT treated as a completion claim", () => {
    expectTrue(!replyClaimsCompletedAction("I'll create the company and add Praveen next."));
    expectTrue(!replyClaimsCompletedAction("Happy to set up a follow-up task if you want."));
    expectTrue(!replyClaimsCompletedAction("Let me draft an outreach email for review."));
  });

  test("plain conversational reply with no claim passes through", () => {
    const reply = "Sounds good — what industry is GreenEdge Robotics in?";
    expectTrue(!replyClaimsCompletedAction(reply));
    const result = reconcileClaimedActions(reply, NOTHING);
    expectTrue(!result.falseClaim);
    expectTrue(result.reply === reply);
  });

  test("advice reply mentioning nouns without completion verb passes through", () => {
    const reply =
      "For a deal this size, I'd focus on the buying committee and the technical evaluation.";
    expectTrue(!replyClaimsCompletedAction(reply));
  });

  console.log("\nAll claimed-actions guardrail tests passed.");
}

main();
