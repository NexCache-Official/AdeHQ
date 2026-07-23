// PR-22A/B — Business Architect mapping + adaptive-question stop conditions.
//
// Run: npm run test:workforce-studio:architect

import {
  CONFIDENCE_STOP_THRESHOLD,
  MAX_CLARIFY_QUESTIONS,
  selectNextClarificationQuestion,
} from "../src/lib/hiring/workforce-studio/adaptive-questions";
import { mapDiagnosisToTemplate } from "../src/lib/hiring/workforce-studio/map-diagnosis-to-template";
import { composeBlueprintFromTemplate } from "../src/lib/hiring/workforce-studio/composer";
import { listTemplateManifests } from "../src/lib/hiring/workforce-studio/templates/registry";
import { listCuratedPacks } from "../src/lib/hiring/workforce-studio/ontology/packs";
import { compilePackToManifest } from "../src/lib/hiring/workforce-studio/ontology/compile-pack";
import { assertSafeRule } from "../src/lib/hiring/workforce-studio/json-logic";
import type { BusinessOperatingDiagnosis, ClarificationQuestion } from "../src/lib/hiring/workforce-studio/diagnosis-types";

let failures = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failures += 1;
    console.error(`✗ ${message}`);
  } else {
    console.log(`✓ ${message}`);
  }
}

function baseDiagnosis(overrides: Partial<BusinessOperatingDiagnosis> = {}): BusinessOperatingDiagnosis {
  return {
    businessType: "Test business",
    industry: "general",
    operatingModel: "other",
    narrative: "A small business looking for AI help.",
    revenueMotion: [],
    customerTypes: [],
    productsAndServices: [],
    operatingChannels: [],
    recurringWork: [],
    currentHumanRoles: [],
    bottlenecks: [],
    risks: [],
    growthPriorities: [],
    proposedDepartments: [],
    confidence: 0.55,
    assumptions: [],
    clarificationQuestions: [],
    designReasons: ["Reason one", "Reason two", "Reason three"],
    ...overrides,
  };
}

function makeQuestions(n: number): ClarificationQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q_${i + 1}`,
    prompt: `Question ${i + 1}?`,
    whyItMatters: "Coverage",
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  }));
}

console.log("=== Workforce Studio Business Architect tests ===\n");

// Ontology packs compile cleanly
for (const pack of listCuratedPacks()) {
  const manifest = compilePackToManifest(pack);
  const seatIds = new Set(manifest.baseSeats.map((s) => s.templateSeatId));
  const roomIds = new Set(manifest.baseRooms.map((r) => r.templateRoomId));
  assert(manifest.baseSeats.length >= 1, `[${pack.key}] has seats`);
  for (const seat of manifest.baseSeats) {
    if (seat.primaryRoomTemplateId) {
      assert(roomIds.has(seat.primaryRoomTemplateId), `[${pack.key}] seat ${seat.templateSeatId} room resolves`);
    }
  }
  for (const edge of manifest.baseEdges) {
    assert(
      seatIds.has(edge.fromSeatTemplateId) && seatIds.has(edge.toSeatTemplateId),
      `[${pack.key}] edge ${edge.fromSeatTemplateId}->${edge.toSeatTemplateId} seats resolve`,
    );
  }
  for (const rule of manifest.scalingRules) {
    try {
      assertSafeRule(rule.condition);
    } catch {
      assert(false, `[${pack.key}] scaling rule ${rule.id} unsafe`);
    }
  }
}

{
  const shopify = mapDiagnosisToTemplate(
    baseDiagnosis({
      businessType: "DTC apparel",
      industry: "ecommerce",
      operatingModel: "commerce",
      narrative: "We sell on Shopify and need help with refunds and fulfilment.",
      productsAndServices: ["apparel", "Shopify store"],
      operatingChannels: ["shopify", "instagram"],
    }),
    [{ questionId: "q_biggest_pain", optionId: "support" }],
  );
  assert(shopify.templateKey === "shopify_store" || shopify.archetypeId === "ecommerce_dtc", `Shopify → commerce pack (got ${shopify.templateKey})`);
  assert(shopify.moduleIds.includes("customer_support") || shopify.moduleIds.includes("ecommerce_ops"), "Shopify modules include commerce/support");
  const roles = shopify.manifest.baseSeats.map((s) => s.roleKey);
  assert(roles.includes("customer_support_agent") || roles.includes("operations_assistant"), "Shopify seats include CX/ops roles");
  const payload = composeBlueprintFromTemplate(shopify.manifest, shopify.intakeAnswers, null);
  assert(payload.seats.length >= 3, `Shopify compose has seats (${payload.seats.length})`);
}

{
  const saas = mapDiagnosisToTemplate(
    baseDiagnosis({
      businessType: "B2B analytics",
      industry: "software",
      operatingModel: "software",
      narrative: "We run a SaaS subscription product for product teams.",
      productsAndServices: ["SaaS dashboard"],
    }),
  );
  assert(saas.templateKey === "saas_startup", `SaaS → saas_startup (got ${saas.templateKey})`);
}

{
  const agency = mapDiagnosisToTemplate(
    baseDiagnosis({
      businessType: "Mobile app studio",
      industry: "software",
      operatingModel: "service",
      narrative: "We are a development agency shipping client mobile apps.",
      productsAndServices: ["bespoke mobile apps", "client work"],
    }),
  );
  assert(agency.templateKey === "software_house", `Agency → software_house (got ${agency.templateKey})`);
}

{
  const restaurant = mapDiagnosisToTemplate(
    baseDiagnosis({
      businessType: "Neighborhood bistro",
      industry: "restaurants",
      operatingModel: "hospitality",
      narrative: "A restaurant with reservations, suppliers, and staffing chaos.",
      productsAndServices: ["dine-in", "takeout"],
    }),
    [{ questionId: "q_biggest_pain", optionId: "support" }],
  );
  assert(restaurant.templateKey === "restaurant" || restaurant.archetypeId === "restaurant_hospitality", `Restaurant pack (got ${restaurant.templateKey})`);
  const missionBlob = restaurant.manifest.baseSeats.map((s) => s.missionTemplate).join(" ").toLowerCase();
  assert(/reservation|guest|allergen|menu|hospitality|cover/.test(missionBlob), "Restaurant missions use hospitality language");
}

{
  const accounting = mapDiagnosisToTemplate(
    baseDiagnosis({
      businessType: "Local accounting practice",
      industry: "accounting",
      operatingModel: "professional_services",
      narrative: "We are an accounting firm handling books and client filings.",
      productsAndServices: ["bookkeeping", "tax"],
    }),
  );
  assert(accounting.archetypeId === "professional_services", `Accounting archetype (got ${accounting.archetypeId})`);
  assert(
    accounting.moduleIds.includes("finance_reporting") ||
      accounting.manifest.baseSeats.some((s) => s.roleKey === "bookkeeping_assistant"),
    "Accounting includes finance/bookkeeping coverage",
  );
}

assert(listTemplateManifests().length >= 20, `Registry has many packs (got ${listTemplateManifests().length})`);

// Adaptive question stop conditions
{
  const questions = makeQuestions(5);
  const diagnosis = baseDiagnosis({ confidence: 0.4, clarificationQuestions: questions });
  const first = selectNextClarificationQuestion(diagnosis, []);
  assert(first.done === false && first.question.id === "q_1", "First call returns q_1");
  const mid = selectNextClarificationQuestion(diagnosis, [{ questionId: "q_1", optionId: "a" }]);
  assert(mid.done === false, "After 1 answer with low confidence, still asks");
}

{
  const questions = makeQuestions(5);
  const diagnosis = baseDiagnosis({
    confidence: CONFIDENCE_STOP_THRESHOLD,
    clarificationQuestions: questions,
  });
  const result = selectNextClarificationQuestion(diagnosis, [
    { questionId: "q_1", optionId: "a" },
    { questionId: "q_2", optionId: "b" },
  ]);
  assert(result.done === true && result.reason === "confidence", "Stops early when confidence ≥ threshold after ≥2 answers");
}

{
  const questions = makeQuestions(3);
  const diagnosis = baseDiagnosis({ confidence: 0.3, clarificationQuestions: questions });
  const answers = questions.map((q) => ({ questionId: q.id, optionId: "a" }));
  const result = selectNextClarificationQuestion(diagnosis, answers);
  assert(result.done === true && (result.reason === "exhausted" || result.reason === "cap"), "Exhausted queue → done");
}

{
  const questions = makeQuestions(MAX_CLARIFY_QUESTIONS + 2);
  const diagnosis = baseDiagnosis({ confidence: 0.2, clarificationQuestions: questions });
  const answers = questions.slice(0, MAX_CLARIFY_QUESTIONS).map((q) => ({
    questionId: q.id,
    optionId: "a",
  }));
  const result = selectNextClarificationQuestion(diagnosis, answers);
  assert(result.done === true, `Cap/exhaust after ${MAX_CLARIFY_QUESTIONS} answers`);
}

console.log(`\n=== Done: ${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`} ===`);
process.exit(failures === 0 ? 0 : 1);
