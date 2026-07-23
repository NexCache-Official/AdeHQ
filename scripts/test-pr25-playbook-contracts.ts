/**
 * PR-25 — seed playbook contract/DAG validation (no DB).
 *
 *   npm run test:pr25:contracts
 */
import {
  PLATFORM_PLAYBOOK_SEEDS,
  validatePlaybookDefinition,
  validatePlaybookDag,
} from "../src/lib/playbooks";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const EMPLOYEE_ID_RE = /^(emp_|employee_|usr_|user_)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

console.log("\n=== PR-25 playbook contracts ===\n");

check("seed catalog non-empty", PLATFORM_PLAYBOOK_SEEDS.length >= 10);

for (const seed of PLATFORM_PLAYBOOK_SEEDS) {
  const defResult = validatePlaybookDefinition(seed);
  check(
    `${seed.key}: validatePlaybookDefinition`,
    defResult.ok,
    defResult.errors.join("; "),
  );

  const dagResult = validatePlaybookDag(seed.steps);
  check(
    `${seed.key}: validatePlaybookDag`,
    dagResult.ok,
    dagResult.errors.join("; "),
  );
  check(
    `${seed.key}: no DAG cycle`,
    !dagResult.errors.some((e) => /cycle/i.test(e)),
  );
  check(`${seed.key}: schemaVersion 1`, seed.schemaVersion === 1);

  for (const role of seed.roleRequirements) {
    check(
      `${seed.key}: roleKey not employee id (${role.roleKey})`,
      !EMPLOYEE_ID_RE.test(role.roleKey),
    );
  }
  for (const step of seed.steps) {
    check(
      `${seed.key}/${step.stepKey}: step.roleKey not employee id`,
      !EMPLOYEE_ID_RE.test(step.roleKey),
    );
    const raw = step as Record<string, unknown>;
    check(
      `${seed.key}/${step.stepKey}: no embedded employeeId`,
      !("employeeId" in raw) && !("employee_id" in raw),
    );
  }
}

console.log(`\n${failed ? `Failed: ${failed}` : "All playbook contract checks passed."}\n`);
process.exit(failed ? 1 : 0);
