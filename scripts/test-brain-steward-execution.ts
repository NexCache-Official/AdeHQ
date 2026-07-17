/**
 * PR-19 Session 3 — Steward execution unit tests (leases/findings/progress/receipts/DAG).
 * No live providers.
 *
 *   npm run test:brain:steward-execution
 */
import {
  buildCollaborationPlan,
  validateCollaborationPlan,
  getMultiAgentPolicy,
  buildInitialProgress,
  updateStepProgress,
  formatCoordinationLine,
  formatStepLine,
  buildCollaborationReceipt,
  formatReceiptSummary,
  formatStewardFailureMessage,
  formatFindingsBoard,
} from "../src/lib/brain/steward";
import type { SharedFinding } from "../src/lib/brain/steward";
import type { CollaborationPlan } from "../src/lib/brain/steward";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const alex = { id: "emp_alex", name: "Alex", roleKey: "pm" };
const priya = { id: "emp_priya", name: "Priya", roleKey: "analyst" };
const jordan = { id: "emp_jordan", name: "Jordan", roleKey: "engineer" };
const roster = [alex, priya, jordan];
const accessible = roster.map((e) => e.id);
const names = new Map(roster.map((e) => [e.id, e.name]));

console.log("\n=== PR-19 Steward execution foundation ===\n");

const { plan, policy } = buildCollaborationPlan({
  message: "Research the market and draft outreach for Acme",
  candidates: roster,
  accessibleEmployeeIds: accessible,
  roomEmployeeIds: accessible,
  preferredEmployeeIds: [alex.id, priya.id],
});

check("execution plan built", Boolean(plan && plan.steps.length >= 2));
check(
  "plan validates for execution",
  Boolean(plan && validateCollaborationPlan(plan, {
    accessibleEmployeeIds: accessible,
    roomEmployeeIds: accessible,
    policy,
  }).ok),
);

if (plan) {
  const progress = buildInitialProgress("brun_test", plan, names);
  check("progress starts running or waiting", progress.status === "running" || progress.status === "waiting_for_approval");
  check(
    "coordination line mentions lead",
    formatCoordinationLine(progress).includes("Alex"),
  );

  const first = plan.steps[0];
  let next = updateStepProgress(progress, first.stepId, "running");
  check("step line shows in-progress", formatStepLine(next.steps[0]).startsWith("•"));
  next = updateStepProgress(next, first.stepId, "completed", first.estimatedWh);
  check("completed step checkmark", formatStepLine(next.steps[0]).startsWith("✓"));

  // Simulate completing all steps
  for (const step of plan.steps) {
    next = updateStepProgress(next, step.stepId, "completed", step.estimatedWh);
  }
  check("all complete → completed status", next.status === "completed");

  const receipt = buildCollaborationReceipt(plan, next, names);
  check("receipt has total WH", receipt.totalWorkHours > 0);
  check("receipt summary readable", /Work Hours/.test(formatReceiptSummary(receipt)));
  check("attribution mentions lead", /Alex/.test(receipt.attribution));
}

check(
  "failure copy is user-safe",
  !/openai|silicon|provider|stack/i.test(
    formatStewardFailureMessage("Priya", "Alex"),
  ) && formatStewardFailureMessage("Priya", "Alex").includes("Priya"),
);

const findings: SharedFinding[] = [
  {
    id: "f1",
    brainRunId: "brun_test",
    producedByEmployeeId: priya.id,
    title: "Market notes",
    summary: "Acme is expanding in EU.",
    evidenceSourceIds: [],
    artifactIds: [],
    confidence: 0.8,
    visibility: "lead_only",
    containsPrivateDmContext: false,
  },
];
check("findings board formats", formatFindingsBoard(findings).includes("Market notes"));

// DAG dependency helper via plan structure
if (plan) {
  const synth = plan.steps.find((s) => s.capability === "synthesis");
  check("synthesis depends on prior work", Boolean(synth && synth.dependsOn.length >= 1));
  check("no recursive delegation (one synthesis)", plan.steps.filter((s) => s.capability === "synthesis").length === 1);
}

// Cost cap policy
const expensive = buildCollaborationPlan({
  message: "Research the market and draft a board launch plan with legal review",
  candidates: roster,
  accessibleEmployeeIds: accessible,
  preferredEmployeeIds: accessible,
  policy: { ...getMultiAgentPolicy(), autoWhLimit: 1 },
});
check(
  "expensive collab may require approval",
  Boolean(expensive.plan?.approvalRequired),
);

// Acyclic validation
const cyclic: CollaborationPlan = {
  objective: "x",
  leadEmployeeId: alex.id,
  mode: "delegated",
  steps: [
    {
      stepId: "a",
      objective: "a",
      capability: "reasoning",
      employeeId: alex.id,
      dependsOn: ["b"],
      expectedOutput: "a",
      shareScope: "room",
      estimatedWh: 1,
    },
    {
      stepId: "b",
      objective: "b",
      capability: "reasoning",
      employeeId: priya.id,
      dependsOn: ["a"],
      expectedOutput: "b",
      shareScope: "room",
      estimatedWh: 1,
    },
  ],
  maxCollaborators: 2,
  maxSteps: 8,
  estimatedWhMin: 1,
  estimatedWhMax: 2,
  hardWhLimit: 5,
  approvalRequired: false,
};
check(
  "cyclic plan rejected",
  !validateCollaborationPlan(cyclic, {
    accessibleEmployeeIds: accessible,
    roomEmployeeIds: accessible,
    policy: getMultiAgentPolicy(),
  }).ok,
);

console.log(`\n${failed ? `Failed: ${failed}` : "All steward execution checks passed."}\n`);
process.exit(failed ? 1 : 0);
