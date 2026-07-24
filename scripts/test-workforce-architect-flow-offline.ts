// Offline end-to-end architect path (no SiliconFlow / Supabase).
// Run: npx tsx scripts/test-workforce-architect-flow-offline.ts

import { diagnoseBusinessHeuristic, normalizeDiagnosis } from "../src/lib/hiring/workforce-studio/diagnose-business";
import { selectNextClarificationQuestion } from "../src/lib/hiring/workforce-studio/adaptive-questions";
import { mapDiagnosisToTemplate } from "../src/lib/hiring/workforce-studio/map-diagnosis-to-template";
import { composeBlueprintFromTemplate } from "../src/lib/hiring/workforce-studio/composer";
import { forecastWorkHours, runSimulation } from "../src/lib/hiring/workforce-studio/simulation";
import { pruneSeatsFromPayload } from "../src/lib/hiring/workforce-studio/seat-brief";
import type { ClarificationAnswer } from "../src/lib/hiring/workforce-studio/diagnosis-types";

const SOFTWARE = new Set([
  "software_engineer",
  "full_stack_developer",
  "qa_test_engineer",
  "product_manager",
]);

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

function runScenario(id: string, description: string, opts: {
  expectPack?: string;
  forbidSoftware?: boolean;
  requireRoles?: string[];
}) {
  console.log(`\n--- ${id} ---`);
  console.log(`Prompt: ${description}`);
  let diagnosis = diagnoseBusinessHeuristic(description);
  diagnosis.narrative = `${diagnosis.narrative} ${description}`;
  diagnosis.productsAndServices = [description.slice(0, 60)];
  diagnosis = normalizeDiagnosis(diagnosis, description);

  assert(Boolean(diagnosis.businessType), `${id}: businessType set (${diagnosis.businessType})`);
  assert(Boolean(diagnosis.operatingModel), `${id}: operatingModel ${diagnosis.operatingModel}`);

  const answers: ClarificationAnswer[] = [];
  let guard = 0;
  while (guard++ < 6) {
    const next = selectNextClarificationQuestion(diagnosis, answers);
    if (next.done) break;
    const option = next.question.options[0];
    answers.push({ questionId: next.question.id, optionId: option.id });
    console.log(`  Q: ${next.question.prompt.slice(0, 70)}… → ${option.label}`);
  }

  const mapping = mapDiagnosisToTemplate(diagnosis, answers);
  const payload = composeBlueprintFromTemplate(mapping.manifest, mapping.intakeAnswers, null);
  const roles = payload.seats.map((s) => s.roleKey);
  const bands = forecastWorkHours(payload.seats);
  const sim = runSimulation(payload, mapping.manifest.scenarios ?? [], 1);

  console.log(`  Pack: ${mapping.templateKey} (${mapping.mappingReason})`);
  console.log(
    `  Seats: ${payload.seats.map((s) => s.roleTitle).join(" · ")}`,
  );
  console.log(
    `  WH band: ${Math.round(bands.reduce((a, b) => a + b.lowWh, 0))}–${Math.round(bands.reduce((a, b) => a + b.highWh, 0))}`,
  );
  console.log(`  Simulation findings: ${sim.findings.length} (critical: ${sim.findings.filter((f) => f.severity === "critical").length})`);

  if (opts.expectPack) {
    assert(mapping.templateKey === opts.expectPack, `${id}: pack ${opts.expectPack} (got ${mapping.templateKey})`);
  }
  if (opts.forbidSoftware) {
    assert(!roles.some((r) => SOFTWARE.has(r)), `${id}: no software roles (got ${roles.join(", ")})`);
  }
  for (const role of opts.requireRoles ?? []) {
    assert(roles.includes(role), `${id}: requires ${role} (got ${roles.join(", ")})`);
  }

  // Seat prune helper
  if (payload.seats.length >= 2) {
    const keep = new Set([payload.seats[0].id, payload.seats[1].id]);
    const pruned = pruneSeatsFromPayload(payload, keep);
    assert(pruned.seats.length === 2, `${id}: prune keeps 2 seats`);
    assert(
      pruned.edges.every((e) => keep.has(e.fromSeatId) && keep.has(e.toSeatId)),
      `${id}: prune cleans edges`,
    );
  }
}

console.log("=== Offline Workforce Studio architect flow ===");

runScenario(
  "vacation_rental",
  "Boutique vacation-rental property manager with 12 listings. Guest messaging, turnover cleaning coordination, and monthly owner reports eat most of the week.",
  {
    expectPack: "property_management",
    forbidSoftware: true,
    requireRoles: ["operations_assistant"],
  },
);

runScenario(
  "accounting_partners",
  "We are a small accounting firm with three partners. Proposal writing and client follow-ups eat most of our week.",
  {
    expectPack: "accounting_firm",
    forbidSoftware: true,
    requireRoles: ["bookkeeping_assistant", "sales_development_rep"],
  },
);

// LLM-shaped bug still fixed after clarify answers
{
  console.log("\n--- accounting_llm_shaped ---");
  const diagnosis = normalizeDiagnosis(
    {
      ...diagnoseBusinessHeuristic("x"),
      businessType: "Professional services (accounting firm)",
      industry: "Accounting",
      operatingModel: "service",
      narrative:
        "Partners doing bespoke client work on proposals and follow-ups instead of advisory.",
      productsAndServices: ["tax", "audit"],
      designReasons: ["a", "b"],
    },
    "Small accounting firm proposals follow-ups",
  );
  const mapping = mapDiagnosisToTemplate(diagnosis, [
    { questionId: "q_team_size", optionId: "lean" },
  ]);
  const payload = composeBlueprintFromTemplate(mapping.manifest, mapping.intakeAnswers, null);
  assert(mapping.templateKey === "accounting_firm", "llm-shaped → accounting_firm");
  assert(
    !payload.seats.some((s) => SOFTWARE.has(s.roleKey)),
    "llm-shaped has no software seats",
  );
}

console.log(`\n=== Done: ${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);
