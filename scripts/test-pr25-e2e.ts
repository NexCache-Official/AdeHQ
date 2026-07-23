/**
 * PR-25 — lightweight in-memory playbook orchestration (no DB).
 * load seed → estimate → build plan → match roles → simulate steps → receipt
 */
import {
  getPlaybookSeedByKey,
  validatePlaybookDefinition,
  estimatePlaybookWh,
  buildExecutionPlan,
  matchPlaybookRoles,
  createPlaybookRunEnvelope,
  advanceReadySteps,
  enforceHardWhCap,
  buildPlaybookReceipt,
  canTransitionPlaybookRun,
  assertPlaybookStepTransition,
} from "../src/lib/playbooks";
import type { PlaybookRoleCandidate, PlaybookRunEnvelopeStep } from "../src/lib/playbooks";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== PR-25 e2e orchestration (in-memory) ===\n");

const definition = getPlaybookSeedByKey("competitor_analysis");
check("load seed", Boolean(definition));
if (!definition) {
  process.exit(1);
}

const validation = validatePlaybookDefinition(definition);
check("validate definition", validation.ok, validation.errors.join("; "));

const estimate = estimatePlaybookWh(definition);
check("estimate", estimate.estimatedWhMin > 0 && estimate.estimatedWhMax > estimate.estimatedWhMin);

const candidates: PlaybookRoleCandidate[] = [
  {
    employeeId: "emp_researcher",
    roleTags: ["researcher"],
    capabilityTags: ["search"],
  },
  {
    employeeId: "emp_analyst",
    roleTags: ["analyst"],
    capabilityTags: ["reasoning", "review"],
  },
  {
    employeeId: "emp_writer",
    roleTags: ["writer"],
    capabilityTags: ["writing"],
  },
];
const assignments = matchPlaybookRoles(definition.roleRequirements, candidates);
check("match roles", assignments.length === definition.roleRequirements.length);

const plan = buildExecutionPlan(definition, assignments, {
  company: "Acme",
  competitors: ["RivalCo"],
});
check("build plan", plan.waves.length >= 2 && plan.steps.length === definition.steps.length);

let envelope = createPlaybookRunEnvelope({
  definition,
  roleAssignments: assignments,
  inputPayload: { company: "Acme", competitors: ["RivalCo"] },
  status: "queued",
});
check("create envelope", envelope.status === "queued");
check("transition queued→running", canTransitionPlaybookRun(envelope.status, "running"));
envelope = { ...envelope, status: "running" };

let steps: PlaybookRunEnvelopeStep[] = envelope.steps;
let actualWh = 0;
const order = [...plan.steps].sort((a, b) => a.wave - b.wave || a.stepKey.localeCompare(b.stepKey));

for (const planned of order) {
  steps = advanceReadySteps(steps, definition);
  const current = steps.find((s) => s.stepKey === planned.stepKey);
  check(`${planned.stepKey}: became ready`, current?.status === "ready");
  if (!current) break;

  assertPlaybookStepTransition(current.status, "running");
  const nextWh = current.estimatedWh;
  const cap = enforceHardWhCap(actualWh, nextWh, envelope.hardWhLimit);
  check(`${planned.stepKey}: under WH cap`, cap.allowed);
  actualWh += cap.nextMax;

  steps = steps.map((s) =>
    s.stepKey === planned.stepKey
      ? { ...s, status: "completed" as const, actualWh: cap.nextMax }
      : s,
  );
}

check(
  "all steps completed",
  steps.every((s) => s.status === "completed"),
);

envelope = {
  ...envelope,
  status: "completed",
  actualWh,
  steps,
};
const receipt = buildPlaybookReceipt(envelope, steps, definition);
check("receipt status completed", receipt.status === "completed");
check("receipt actualWh > 0", receipt.actualWh > 0);
check("receipt lines present", receipt.lines.length >= 1);
check(
  "receipt clean of providers",
  !/openai|silicon|anthropic|gpt-|provider/i.test(JSON.stringify(receipt)),
);

console.log(`\n${failed ? `Failed: ${failed}` : "PR-25 e2e orchestration passed."}\n`);
process.exit(failed ? 1 : 0);
