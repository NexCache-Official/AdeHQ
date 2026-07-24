// Offline regression: LLM-shaped diagnoses must not route professional firms
// into software_house. Run: npm run test:workforce-studio:pack-selection

import { diagnoseBusinessHeuristic, normalizeDiagnosis } from "../src/lib/hiring/workforce-studio/diagnose-business";
import { mapDiagnosisToTemplate } from "../src/lib/hiring/workforce-studio/map-diagnosis-to-template";
import { composeBlueprintFromTemplate } from "../src/lib/hiring/workforce-studio/composer";
import { selectArchetypeAndPack } from "../src/lib/hiring/workforce-studio/ontology/select-pack";
import type { BusinessOperatingDiagnosis } from "../src/lib/hiring/workforce-studio/diagnosis-types";
import { clarificationNeedsFreeText } from "../src/lib/hiring/workforce-studio/clarification-ui";
import { pruneSeatsFromPayload } from "../src/lib/hiring/workforce-studio/seat-brief";

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failures += 1;
    console.error(`✗ ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

const SOFTWARE_ROLES = [
  "software_engineer",
  "full_stack_developer",
  "qa_test_engineer",
  "product_manager",
];

function rolesFor(diagnosis: BusinessOperatingDiagnosis) {
  const mapping = mapDiagnosisToTemplate(diagnosis, [
    { questionId: "q_team_size", optionId: "lean" },
  ]);
  const payload = composeBlueprintFromTemplate(mapping.manifest, mapping.intakeAnswers, null);
  return { mapping, roles: payload.seats.map((s) => s.roleKey) };
}

console.log("=== Workforce pack-selection regressions ===\n");

// Exact failure shape from production (user screenshot mappingReason).
const buggyAccounting: BusinessOperatingDiagnosis = normalizeDiagnosis(
  {
    ...diagnoseBusinessHeuristic("generic business"),
    businessType: "Professional services (accounting firm)",
    industry: "Accounting",
    operatingModel: "service",
    narrative:
      "You are a small accounting firm bleeding partner time on proposal drafting and client follow-ups — high-value partners doing bespoke client work instead of advisory.",
    productsAndServices: ["tax", "audit", "bookkeeping"],
    operatingChannels: ["email", "meetings"],
    designReasons: [
      "Partners should not spend billable hours on admin follow-ups.",
      "Proposal work can be templated and delegated.",
    ],
  },
  "We are a small accounting firm with three partners. Proposal writing and client follow-ups eat most of our week.",
);

assert(
  buggyAccounting.operatingModel === "professional_services",
  "normalizeDiagnosis forces professional_services for accounting",
);

{
  const sel = selectArchetypeAndPack(buggyAccounting, []);
  assert(sel.manifest.key === "accounting_firm" || sel.pack?.key === "accounting_firm",
    `buggy accounting → accounting_firm (got ${sel.manifest.key} / ${sel.pack?.key})`);
  assert(!/software_house/.test(sel.mappingReason), `mappingReason not software_house (got ${sel.mappingReason})`);
  const { roles } = rolesFor(buggyAccounting);
  for (const forbidden of SOFTWARE_ROLES) {
    assert(!roles.includes(forbidden), `buggy accounting forbids ${forbidden} (got ${roles.join(", ")})`);
  }
  assert(roles.includes("bookkeeping_assistant"), `buggy accounting includes bookkeeping (got ${roles.join(", ")})`);
  assert(
    roles.includes("sales_development_rep") || roles.includes("operations_assistant"),
    `buggy accounting includes proposals/ops seat (got ${roles.join(", ")})`,
  );
}

{
  const h = diagnoseBusinessHeuristic(
    "We are a small accounting firm with three partners. Proposal writing and client follow-ups eat most of our week.",
  );
  h.narrative = h.narrative + " accounting firm proposals";
  const { mapping, roles } = rolesFor(h);
  assert(mapping.templateKey === "accounting_firm", `heuristic accounting pack (got ${mapping.templateKey})`);
  assert(!roles.some((r) => SOFTWARE_ROLES.includes(r)), `heuristic accounting has no software roles`);
}

{
  const h = diagnoseBusinessHeuristic(
    "We are a software agency / development house shipping client software for startups.",
  );
  h.narrative = "software agency development house client software";
  const sel = selectArchetypeAndPack(h, []);
  assert(
    sel.manifest.key === "software_house" || sel.archetype.id === "software_agency",
    `real software agency still maps to software (got ${sel.manifest.key} / ${sel.archetype.id})`,
  );
}

{
  const q = {
    id: "q_mix",
    prompt: "What's your primary service mix?",
    whyItMatters: "Shapes proposals.",
    options: [
      { id: "tax", label: "Tax compliance & filing" },
      { id: "mix", label: "Mix (specify)" },
    ],
  };
  assert(clarificationNeedsFreeText(q, "mix"), "Mix (specify) needs free text");
  assert(!clarificationNeedsFreeText(q, "tax"), "plain option does not force free text");
}

{
  const h = diagnoseBusinessHeuristic(
    "We are a small accounting firm with three partners. Proposal writing and client follow-ups eat most of our week.",
  );
  h.narrative = "accounting firm proposals";
  const { mapping } = rolesFor(h);
  const payload = composeBlueprintFromTemplate(mapping.manifest, mapping.intakeAnswers, null);
  const keep = new Set(payload.seats.slice(0, 2).map((s) => s.id));
  const pruned = pruneSeatsFromPayload(payload, keep);
  assert(pruned.seats.length === 2, `prune keeps 2 seats (got ${pruned.seats.length})`);
  assert(
    pruned.rooms.every((r) => r.memberSeatIds.every((id) => keep.has(id))),
    "prune rooms only reference kept seats",
  );
  assert(
    pruned.edges.every((e) => keep.has(e.fromSeatId) && keep.has(e.toSeatId)),
    "prune edges only reference kept seats",
  );
}

console.log(`\n=== Done: ${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);
