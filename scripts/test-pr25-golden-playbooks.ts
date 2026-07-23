/**
 * PR-25 — golden scenarios: competitor / PRD / data insight packs (no DB).
 */
import {
  getPlaybookSeedByKey,
  validatePlaybookDefinition,
  estimatePlaybookWh,
  buildExecutionPlan,
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

const GOLDENS = [
  {
    key: "competitor_analysis",
    label: "competitor pack",
    input: { company: "Acme", competitors: ["Beta", "Gamma"] },
  },
  {
    key: "product_idea_to_prd",
    label: "PRD pack",
    input: { idea: "AI inbox triage", users: "Ops teams" },
  },
  {
    key: "data_file_to_insight_pack",
    label: "data insight pack",
    input: { dataset: "metrics.csv", question: "What drove churn?" },
  },
] as const;

console.log("\n=== PR-25 golden playbooks ===\n");

for (const golden of GOLDENS) {
  const def = getPlaybookSeedByKey(golden.key);
  check(`${golden.label}: seed found`, Boolean(def));
  if (!def) continue;

  const validation = validatePlaybookDefinition(def);
  check(`${golden.label}: definition valid`, validation.ok, validation.errors.join("; "));

  const candidates: PlaybookRoleCandidate[] = def.roleRequirements.map((r, i) => ({
    employeeId: `emp_${r.roleKey}_${i}`,
    capabilityTags: r.capabilityTags ?? [],
    roleTags: r.roleTags ?? [r.roleKey],
  }));
  const assignments = matchPlaybookRoles(def.roleRequirements, candidates);
  check(
    `${golden.label}: roles matched`,
    assignments.length >= def.roleRequirements.length,
  );

  const plan = buildExecutionPlan(def, assignments, golden.input);
  check(`${golden.label}: plan built`, plan.steps.length === def.steps.length);
  check(`${golden.label}: waves present`, plan.waves.length >= 1);

  const estimate = estimatePlaybookWh(def);
  check(`${golden.label}: estimate > 0`, estimate.totalEstimatedWh > 0);
  check(
    `${golden.label}: estimate under hard limit policy`,
    estimate.totalEstimatedWh <= def.policies.hardWhLimit ||
      estimate.hardWhLimit >= estimate.estimatedWhMax,
  );
}

console.log(`\n${failed ? `Failed: ${failed}` : "All golden playbook checks passed."}\n`);
process.exit(failed ? 1 : 0);
