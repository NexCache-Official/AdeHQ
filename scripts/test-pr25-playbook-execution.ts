/**
 * PR-25 — planner waves, advanceReadySteps, hard WH cap, state machine (no DB).
 *
 *   npm run test:pr25
 */
import {
  PLATFORM_PLAYBOOK_SEEDS,
  buildExecutionPlan,
  createPlaybookRunEnvelope,
  advanceReadySteps,
  enforceHardWhCap,
  canTransitionPlaybookRun,
  canTransitionPlaybookStep,
  assertPlaybookRunTransition,
  assertPlaybookStepTransition,
  matchPlaybookRoles,
} from "../src/lib/playbooks";
import type { PlaybookRoleCandidate } from "../src/lib/playbooks";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== PR-25 playbook execution ===\n");

const definition =
  PLATFORM_PLAYBOOK_SEEDS.find((p) => p.key === "competitor_analysis") ??
  PLATFORM_PLAYBOOK_SEEDS[0]!;

const candidates: PlaybookRoleCandidate[] = definition.roleRequirements.map((r, i) => ({
  employeeId: `emp_${r.roleKey}_${i}`,
  capabilityTags: r.capabilityTags ?? [],
  roleTags: r.roleTags ?? [r.roleKey],
}));
const assignments = matchPlaybookRoles(definition.roleRequirements, candidates);
const plan = buildExecutionPlan(definition, assignments, { company: "Acme" });

check("plan has waves", plan.waves.length >= 2);
check("wave 0 has root steps", (plan.waves[0]?.stepKeys.length ?? 0) >= 1);
check(
  "later waves non-empty for DAG",
  plan.waves.slice(1).some((w) => w.stepKeys.length > 0),
);
check(
  "every step assigned a wave",
  plan.steps.every((s) => typeof s.wave === "number" && s.wave >= 0),
);

const envelope = createPlaybookRunEnvelope({
  definition,
  roleAssignments: assignments,
  inputPayload: { company: "Acme" },
});
check(
  "root steps start ready",
  envelope.steps.filter((s) => s.dependsOn.length === 0).every((s) => s.status === "ready"),
);
check(
  "dependent steps start pending",
  envelope.steps.filter((s) => s.dependsOn.length > 0).every((s) => s.status === "pending"),
);

const root = envelope.steps.find((s) => s.status === "ready")!;
let steps = envelope.steps.map((s) =>
  s.stepKey === root.stepKey ? { ...s, status: "completed" as const, actualWh: s.estimatedWh } : s,
);
steps = advanceReadySteps(steps, definition);
const unlocked = steps.filter(
  (s) =>
    s.status === "ready" &&
    s.dependsOn.includes(root.stepKey),
);
check("advanceReadySteps unlocks dependents", unlocked.length >= 1);

const under = enforceHardWhCap(1, 2, 5);
check("hard cap allows under limit", under.allowed && under.nextMax === 2);
const at = enforceHardWhCap(5, 1, 5);
check("hard cap blocks at limit", !at.allowed && at.nextMax === 0);
const partial = enforceHardWhCap(4, 3, 5);
check("hard cap clamps nextMax", partial.allowed && partial.nextMax === 1);

check("run draft→estimating ok", canTransitionPlaybookRun("draft", "estimating"));
check("run completed→running blocked", !canTransitionPlaybookRun("completed", "running"));
check("step pending→ready ok", canTransitionPlaybookStep("pending", "ready"));
check("step completed→running blocked", !canTransitionPlaybookStep("completed", "running"));

let threw = false;
try {
  assertPlaybookRunTransition("failed", "running");
} catch {
  threw = true;
}
check("assertPlaybookRunTransition throws on illegal", threw);

threw = false;
try {
  assertPlaybookStepTransition("ready", "running");
} catch {
  threw = true;
}
check("assertPlaybookStepTransition allows ready→running", !threw);

console.log(`\n${failed ? `Failed: ${failed}` : "All playbook execution checks passed."}\n`);
process.exit(failed ? 1 : 0);
