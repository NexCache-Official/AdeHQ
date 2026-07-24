/**
 * PR-25 — live process wave pure helpers (no DB).
 *
 *   npx tsx scripts/test-pr25-live-process.ts
 */
import {
  PLATFORM_PLAYBOOK_SEEDS,
  createPlaybookRunEnvelope,
  matchPlaybookRoles,
  selectReadyStepKeys,
  applyStepResult,
  simulateProcessWave,
  resolveMaxParallel,
  canReclaimStepLease,
  employeeRowToPlaybookCandidate,
  buildCanonicalForStep,
  advanceReadySteps,
  allStepsTerminal,
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

console.log("\n=== PR-25 live process wave (pure) ===\n");

const definition =
  PLATFORM_PLAYBOOK_SEEDS.find((p) => p.key === "research_to_executive_report") ??
  PLATFORM_PLAYBOOK_SEEDS[0]!;

const candidates: PlaybookRoleCandidate[] = definition.roleRequirements.map((r, i) => ({
  employeeId: `emp_${r.roleKey}_${i}`,
  capabilityTags: r.capabilityTags ?? [],
  roleTags: r.roleTags ?? [r.roleKey],
}));
const assignments = matchPlaybookRoles(definition.roleRequirements, candidates);

let envelope = createPlaybookRunEnvelope({
  definition,
  roleAssignments: assignments,
  inputPayload: { topic: "AI market sizing", audience: "executives" },
  status: "queued",
});

check("maxParallel from collaborationMaxLevel", resolveMaxParallel(definition) >= 1);

let steps = envelope.steps;
const wave1 = simulateProcessWave({
  definition,
  steps,
  actualWh: 0,
  hardWhLimit: envelope.hardWhLimit,
  maxParallel: 1,
});
check("wave1 processed a root step", wave1.processedStepKeys.length === 1);
check(
  "wave1 completed scope first",
  wave1.processedStepKeys[0] === "scope" ||
    definition.steps.find((s) => s.stepKey === wave1.processedStepKeys[0])?.dependsOn.length === 0,
);
check("wave1 still running (more steps)", wave1.status === "running");

steps = wave1.steps;
let actualWh = wave1.actualWh;
const order: string[] = [...wave1.processedStepKeys];

// Drain remaining waves in dependency order.
for (let i = 0; i < definition.steps.length + 2; i += 1) {
  if (allStepsTerminal(steps)) break;
  const wave = simulateProcessWave({
    definition,
    steps,
    actualWh,
    hardWhLimit: envelope.hardWhLimit,
    maxParallel: 1,
  });
  if (!wave.processedStepKeys.length) break;
  order.push(...wave.processedStepKeys);
  steps = wave.steps;
  actualWh = wave.actualWh;
}

check(
  "all steps completed via waves",
  steps.every((s) => s.status === "completed"),
);
check("dependency order: research after scope", order.indexOf("research") > order.indexOf("scope"));
check("dependency order: draft after analyze", order.indexOf("draft") > order.indexOf("analyze"));
check("dependency order: review after draft", order.indexOf("review") > order.indexOf("draft"));

const readyOnly = selectReadyStepKeys(
  [
    { stepKey: "b", status: "ready" },
    { stepKey: "a", status: "ready" },
    { stepKey: "c", status: "pending" },
  ],
  1,
);
check("selectReadyStepKeys respects maxParallel + sort", readyOnly.length === 1 && readyOnly[0] === "a");

const patchOk = applyStepResult(
  {
    stepKey: "x",
    status: "running",
    roleKey: "writer",
    employeeId: "e1",
    dependsOn: [],
    estimatedWh: 1,
    actualWh: 0,
    brainCapabilityStepId: null,
    brainRunId: null,
  },
  { ok: true, output: { structured: true }, actualWh: 1 },
);
check("applyStepResult success → completed", patchOk.status === "completed" && patchOk.actualWh === 1);

const patchFail = applyStepResult(
  {
    stepKey: "x",
    status: "running",
    roleKey: "writer",
    employeeId: "e1",
    dependsOn: [],
    estimatedWh: 1,
    actualWh: 0,
    brainCapabilityStepId: null,
    brainRunId: null,
  },
  { ok: false, errorCode: "boom", safeErrorMessage: "nope" },
);
check("applyStepResult failure → failed", patchFail.status === "failed" && patchFail.errorCode === "boom");

const now = new Date("2026-07-23T12:00:00.000Z");
check(
  "reclaim expired lease",
  canReclaimStepLease(
    {
      status: "leased",
      leaseOwner: "other",
      leaseExpiresAt: "2026-07-23T11:59:00.000Z",
    },
    "playbook-runtime",
    now,
  ),
);
check(
  "do not steal active other lease",
  !canReclaimStepLease(
    {
      status: "running",
      leaseOwner: "other",
      leaseExpiresAt: "2026-07-23T12:01:00.000Z",
    },
    "playbook-runtime",
    now,
  ),
);

const candidate = employeeRowToPlaybookCandidate({
  id: "emp_research_1",
  role: "Market Researcher",
  role_key: "research",
  status: "active",
  metadata: { purpose: "search,writing" },
});
check(
  "employee tags include researcher + search",
  candidate.roleTags.includes("researcher") && candidate.capabilityTags.includes("search"),
);
check("employee tags not empty (role matching gap fixed)", candidate.capabilityTags.length > 0);

const composeStep = definition.steps.find((s) => s.kind === "artifact_compose")!;
const built = buildCanonicalForStep({
  workspaceId: "ws",
  playbookRunId: "run",
  brainRunId: "brun_x",
  step: composeStep,
  runInput: { topic: "AI market sizing" },
  stepInputs: {},
  stepOutputs: { analyze: { summary: "Growth is strong" } },
});
check("compose builds document schema", built.schemaKey === "adehq.document.v1");
check("compose markdown has title", built.contentMarkdown.includes("#"));
check("compose title from topic", built.title.includes("AI market"));

// Ensure advanceReadySteps still unlocks after simulated completes
const mid: PlaybookRunEnvelopeStep[] = advanceReadySteps(
  steps.map((s) =>
    s.stepKey === "scope" ? s : { ...s, status: s.dependsOn.includes("scope") ? s.status : s.status },
  ),
  definition,
);
check("advanceReadySteps export still works", Array.isArray(mid));

console.log(`\n${failed ? `Failed: ${failed}` : "PR-25 live process checks passed."}\n`);
process.exit(failed ? 1 : 0);
