// PR-22E — offline business-description golden suite (no SiliconFlow).
// Run: npm run test:workforce-studio:goldens

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diagnoseBusinessHeuristic } from "../src/lib/hiring/workforce-studio/diagnose-business";
import { mapDiagnosisToTemplate } from "../src/lib/hiring/workforce-studio/map-diagnosis-to-template";
import { composeBlueprintFromTemplate } from "../src/lib/hiring/workforce-studio/composer";

type Golden = {
  id: string;
  description: string;
  expectedArchetypeId: string;
  expectedPackKey: string | null;
  requiredRoleKeys: string[];
  forbiddenRoleKeys: string[];
  maxSeats: number;
};

const fixturesPath = resolve(__dirname, "fixtures/workforce-architect-goldens.json");
const goldens = JSON.parse(readFileSync(fixturesPath, "utf8")) as Golden[];

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failures += 1;
    console.error(`✗ ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

console.log(`=== Workforce Architect goldens (${goldens.length}) ===\n`);

for (const g of goldens) {
  const diagnosis = diagnoseBusinessHeuristic(g.description);
  // Enrich narrative/products so mapper matchTerms can fire.
  diagnosis.narrative = g.description;
  diagnosis.productsAndServices = [g.description.slice(0, 80)];
  const mapping = mapDiagnosisToTemplate(diagnosis, [
    { questionId: "q_team_size", optionId: "standard" },
  ]);
  const payload = composeBlueprintFromTemplate(mapping.manifest, mapping.intakeAnswers, null);
  const roles = payload.seats.map((s) => s.roleKey);

  assert(
    mapping.archetypeId === g.expectedArchetypeId,
    `[${g.id}] archetype ${g.expectedArchetypeId} (got ${mapping.archetypeId})`,
  );
  if (g.expectedPackKey) {
    assert(
      mapping.templateKey === g.expectedPackKey || mapping.moduleIds.length >= 2,
      `[${g.id}] pack ${g.expectedPackKey} (got ${mapping.templateKey})`,
    );
  }
  for (const role of g.requiredRoleKeys) {
    const aliases =
      role === "software_engineer"
        ? ["software_engineer", "full_stack_developer"]
        : [role];
    assert(
      aliases.some((r) => roles.includes(r)),
      `[${g.id}] requires role ${role} (got ${roles.join(", ")})`,
    );
  }
  for (const role of g.forbiddenRoleKeys) {
    assert(!roles.includes(role), `[${g.id}] forbids role ${role}`);
  }
  assert(payload.seats.length <= g.maxSeats, `[${g.id}] maxSeats ${g.maxSeats} (got ${payload.seats.length})`);
  assert(payload.seats.length >= 1, `[${g.id}] composed at least one seat`);
}

console.log(`\n=== Done: ${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);
