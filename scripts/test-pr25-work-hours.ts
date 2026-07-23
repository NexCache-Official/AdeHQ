/**
 * PR-25 — playbook WH estimator ranges, hard cap, receipt hygiene (no DB).
 */
import {
  PLATFORM_PLAYBOOK_SEEDS,
  estimatePlaybookWh,
  enforceHardWhCap,
  createPlaybookRunEnvelope,
  buildPlaybookReceipt,
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

console.log("\n=== PR-25 work hours ===\n");

const definition =
  PLATFORM_PLAYBOOK_SEEDS.find((p) => p.key === "data_file_to_insight_pack") ??
  PLATFORM_PLAYBOOK_SEEDS[0]!;

const estimate = estimatePlaybookWh(definition);
check("estimate min < max", estimate.estimatedWhMin < estimate.estimatedWhMax);
check(
  "estimate min ≈ 0.85 * total",
  Math.abs(estimate.estimatedWhMin - estimate.totalEstimatedWh * 0.85) < 0.01,
);
check(
  "estimate max ≈ 1.25 * total",
  Math.abs(estimate.estimatedWhMax - estimate.totalEstimatedWh * 1.25) < 0.01,
);
check(
  "hardWhLimit >= estimatedWhMax",
  estimate.hardWhLimit >= estimate.estimatedWhMax,
);
check("breakdown non-empty", estimate.breakdown.length >= 1);

const cap = enforceHardWhCap(estimate.hardWhLimit, 1, estimate.hardWhLimit);
check("enforceHardWhCap at ceiling", !cap.allowed);

const candidates: PlaybookRoleCandidate[] = definition.roleRequirements.map((r, i) => ({
  employeeId: `emp_${r.roleKey}_${i}`,
  capabilityTags: r.capabilityTags ?? [],
  roleTags: r.roleTags ?? [r.roleKey],
}));
const assignments = matchPlaybookRoles(definition.roleRequirements, candidates);
const envelope = createPlaybookRunEnvelope({
  definition,
  roleAssignments: assignments,
  inputPayload: { dataset: "fixture.csv" },
  status: "completed",
});
const completed = {
  ...envelope,
  actualWh: estimate.totalEstimatedWh * 0.9,
  steps: envelope.steps.map((s) => ({
    ...s,
    status: "completed" as const,
    actualWh: s.estimatedWh * 0.9,
  })),
};
const receipt = buildPlaybookReceipt(completed, completed.steps, definition);
const blob = JSON.stringify(receipt);
check("receipt has actualWh", receipt.actualWh > 0);
check(
  "receipt has no provider/model names",
  !/openai|anthropic|siliconflow|groq|gpt-|claude|provider|model/i.test(blob),
);
check("attribution is workspace-safe", /AdeHQ workspace/i.test(receipt.attribution));

console.log(`\n${failed ? `Failed: ${failed}` : "All work-hours checks passed."}\n`);
process.exit(failed ? 1 : 0);
