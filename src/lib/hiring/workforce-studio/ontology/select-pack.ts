// Diagnosis → archetype → curated pack (or ephemeral module set).

import type { BusinessOperatingDiagnosis, ClarificationAnswer } from "../diagnosis-types";
import { answersToLookup } from "../adaptive-questions";
import { ARCHETYPES, getArchetype } from "./archetypes";
import { compileEphemeralManifest, compilePackToManifest } from "./compile-pack";
import { getCuratedPack, listCuratedPacks } from "./packs";
import type { BusinessArchetype, CuratedPack } from "./types";
import type { TemplateManifest } from "../templates/types";

export type PackSelection = {
  archetype: BusinessArchetype;
  pack: CuratedPack | null;
  manifest: TemplateManifest;
  moduleIds: string[];
  adaptationId: string;
  mappingReason: string;
  intakeAnswers: Record<string, unknown>;
};

function blobOf(diagnosis: BusinessOperatingDiagnosis): string {
  return [
    diagnosis.businessType,
    diagnosis.industry,
    diagnosis.narrative,
    ...diagnosis.productsAndServices,
    ...diagnosis.operatingChannels,
  ]
    .join(" ")
    .toLowerCase();
}

export function selectArchetype(diagnosis: BusinessOperatingDiagnosis): BusinessArchetype {
  const blob = blobOf(diagnosis);
  let best = ARCHETYPES.find((a) => a.id === "general_business")!;
  let bestScore = -1;
  for (const archetype of ARCHETYPES) {
    let score = 0;
    let longestHit = 0;
    if (archetype.operatingModel === diagnosis.operatingModel) score += 4;
    for (const term of archetype.matchTerms) {
      if (blob.includes(term)) {
        // Longer phrases beat short ambiguous ones (e.g. "marketing agency" > "agency").
        score += 3 + Math.min(4, Math.floor(term.length / 6));
        longestHit = Math.max(longestHit, term.length);
      }
    }
    const tieBreak = score + longestHit / 100;
    if (tieBreak > bestScore) {
      bestScore = tieBreak;
      best = archetype;
    }
  }
  return best;
}

function painBoost(lookup: Record<string, string>): "support" | "growth" | "ops" | "mixed" {
  const raw =
    lookup.q_biggest_pain ||
    Object.entries(lookup).find(([k]) => k.includes("pain") || k.includes("disruption"))?.[1] ||
    "";
  if (raw === "support" || raw === "growth" || raw === "ops" || raw === "mixed") return raw;
  if (/support|inbox|customer|refund/.test(raw)) return "support";
  if (/growth|market|ads|acquis/.test(raw)) return "growth";
  if (/ops|supplier|admin|fulfill/.test(raw)) return "ops";
  return "mixed";
}

function teamSize(lookup: Record<string, string>, diagnosis: BusinessOperatingDiagnosis): "lean" | "standard" | "scaled" {
  const raw =
    lookup.q_team_size ||
    lookup.team_size ||
    Object.entries(lookup).find(([k]) => k.includes("team_size") || k.includes("size"))?.[1] ||
    "";
  if (raw === "lean" || raw === "standard" || raw === "scaled") return raw;
  if (/lean|small|3|4/.test(raw)) return "lean";
  if (/ambit|scaled|8|large/.test(raw)) return "scaled";
  if (diagnosis.recurringWork.length >= 6) return "standard";
  return "lean";
}

function modulesFor(
  archetype: BusinessArchetype,
  pain: "support" | "growth" | "ops" | "mixed",
  blob: string,
): string[] {
  const ids = [...archetype.defaultModuleIds];
  if (pain === "support" && !ids.includes("customer_support")) ids.push("customer_support");
  if (pain === "growth") {
    if (!ids.includes("marketing_content")) ids.push("marketing_content");
    if (!ids.includes("performance_marketing") && !ids.includes("sales_pipeline")) {
      ids.push("sales_pipeline");
    }
  }
  if (pain === "ops" && !ids.includes("general_operations")) ids.push("general_operations");
  // Description cues (beyond clarification answers)
  if (/\b(support|inbox|refund|ticket)\b/.test(blob) && !ids.includes("customer_support")) {
    ids.push("customer_support");
  }
  if (/\b(sales|pipeline|outbound|sdr)\b/.test(blob) && !ids.includes("sales_pipeline")) {
    ids.push("sales_pipeline");
  }
  if (/\b(marketing|campaign|content|ads)\b/.test(blob) && !ids.includes("marketing_content")) {
    ids.push("marketing_content");
  }
  if (/\b(book|invoice|finance|accounting)\b/.test(blob) && !ids.includes("finance_reporting")) {
    ids.push("finance_reporting");
  }
  if (/\b(executive|founder|ea|follow-ups)\b/.test(blob) && !ids.includes("executive_ops")) {
    ids.push("executive_ops");
  }
  return [...new Set(ids)];
}

function bestPackFor(archetypeId: string, moduleIds: string[]): CuratedPack | null {
  const candidates = listCuratedPacks().filter((p) => p.archetypeId === archetypeId);
  if (candidates.length === 0) {
    // Fall back: any pack sharing many modules.
    const scored = listCuratedPacks()
      .map((p) => {
        const overlap = p.moduleIds.filter((id) => moduleIds.includes(id)).length;
        return { p, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap);
    return scored[0]?.overlap ? scored[0].p : null;
  }
  // Prefer pack whose modules are subset-closest to selected modules.
  let best: CuratedPack | null = candidates[0];
  let bestScore = -Infinity;
  for (const pack of candidates) {
    const overlap = pack.moduleIds.filter((id) => moduleIds.includes(id)).length;
    const extra = pack.moduleIds.length - overlap;
    const score = overlap * 3 - extra;
    if (score > bestScore) {
      bestScore = score;
      best = pack;
    }
  }
  return best;
}

/**
 * Prefer legacy PR-21 manifests for the classic three tech/ops shapes so
 * Simulate/Approve tests and existing blueprints keep stable seat graphs.
 * Industry archetypes always use ontology packs / ephemeral module compile.
 */
function legacyKeyFor(archetype: BusinessArchetype, blob: string): string | null {
  if (archetype.id === "software_agency" && /\b(agency|software house|dev shop|client work|bespoke)\b/.test(blob)) {
    return "software_house";
  }
  if (archetype.id === "software_product" && /\b(saas|b2b software|subscription|product-led)\b/.test(blob)) {
    return "saas_startup";
  }
  if (archetype.id === "general_business" && !/\b(shopify|restaurant|retail|tutoring|property)\b/.test(blob)) {
    return "general_ops";
  }
  return null;
}

export function selectArchetypeAndPack(
  diagnosis: BusinessOperatingDiagnosis,
  answers: ClarificationAnswer[] = [],
): PackSelection {
  const lookup = answersToLookup(answers);
  const archetype = selectArchetype(diagnosis);
  const pain = painBoost(lookup);
  const size = teamSize(lookup, diagnosis);
  const blob = blobOf(diagnosis);
  const moduleIds = modulesFor(archetype, pain, blob);
  // Prefer department packs when the description is explicitly departmental.
  let forcedPackKey: string | null = null;
  if (/\bsales department\b/.test(blob)) forcedPackKey = "sales_department";
  else if (/\bcustomer support department\b|\bsupport department\b/.test(blob)) {
    forcedPackKey = "customer_support_department";
  } else if (/\bfinance and reporting\b|\bfinance team\b/.test(blob)) {
    forcedPackKey = "finance_reporting_team";
  } else if (/\bexecutive office\b/.test(blob)) forcedPackKey = "executive_office";
  else if (/\b(it support|msp|managed service)\b/.test(blob)) forcedPackKey = "it_support_provider";
  else if (/\b(tutoring|tutor)\b/.test(blob)) forcedPackKey = "tutoring_business";
  else if (/\bnewsletter\b/.test(blob)) forcedPackKey = "newsletter_media";
  else if (/\b(multi-location retail|retail fashion)\b/.test(blob)) forcedPackKey = "multi_location_retail";
  else if (/\bconvenience store/.test(blob)) forcedPackKey = "physical_retail_store";
  else if (/\b(wholesale|distribution)\b/.test(blob)) forcedPackKey = "wholesale_distribution";
  else if (/\b(hotel|guesthouse)\b/.test(blob)) forcedPackKey = "hotel_guesthouse";
  else if (/\bmarketing agency\b/.test(blob)) forcedPackKey = "marketing_agency";
  else if (/\brecruitment\b/.test(blob)) forcedPackKey = "recruitment_agency";
  else if (/\breal estate agency\b/.test(blob)) forcedPackKey = "real_estate_agency";
  else if (/\b(consultancy|consulting)\b/.test(blob)) forcedPackKey = "consultancy";
  else if (/\b(nonprofit|charity|community nonprofit)\b/.test(blob)) forcedPackKey = "nonprofit_ops";

  const legacyKey = forcedPackKey ? null : legacyKeyFor(archetype, blob);
  const pack = forcedPackKey
    ? getCuratedPack(forcedPackKey) ?? null
    : legacyKey
      ? null
      : bestPackFor(archetype.id, moduleIds);

  let manifest: TemplateManifest;
  let mappingReason: string;
  let resolvedPack = pack;

  if (legacyKey) {
    // Manifest filled by map-diagnosis via getTemplateManifest(legacyKey).
    manifest = {
      key: legacyKey,
      version: "1.0.0",
      name: legacyKey,
      description: "",
      industry: archetype.id,
      intakeQuestions: [],
      baseSeats: [],
      baseRooms: [],
      baseEdges: [],
      baseOutcomes: [],
      scalingRules: [],
      scenarios: [],
      firstMissionTasks: [],
    };
    mappingReason = `Mapped ${archetype.name} to legacy pack "${legacyKey}".`;
  } else if (pack) {
    manifest = compilePackToManifest(pack);
    mappingReason = `Matched ${archetype.name} → ${pack.name} pack (${pack.moduleIds.length} modules).`;
  } else {
    resolvedPack = getCuratedPack(archetype.id) ?? null;
    manifest = compileEphemeralManifest({
      key: `ephemeral_${archetype.id}`,
      name: `${archetype.name} team`,
      description: archetype.description,
      industry: diagnosis.industry || archetype.id,
      moduleIds,
      adaptationId: archetype.defaultAdaptationId,
    });
    mappingReason = `Composed ephemeral ${archetype.name} team from modules: ${moduleIds.join(", ")}.`;
  }

  const intakeAnswers: Record<string, unknown> = {
    team_size_preference: size,
  };
  for (const q of manifest.intakeQuestions) {
    if (intakeAnswers[q.id] == null && q.defaultValue != null) {
      intakeAnswers[q.id] = q.defaultValue;
    }
  }
  if (pain === "support" && manifest.intakeQuestions.some((q) => q.id === "needs_customer_support")) {
    intakeAnswers.needs_customer_support = "yes";
  }
  if (
    (pain === "ops" || archetype.operatingModel === "commerce") &&
    manifest.intakeQuestions.some((q) => q.id === "needs_automation")
  ) {
    intakeAnswers.needs_automation = "yes";
  }
  if (pain === "support" && manifest.intakeQuestions.some((q) => q.id === "primary_ops_focus")) {
    intakeAnswers.primary_ops_focus = "executive_support";
  }

  const resolvedArchetype =
    (resolvedPack ? getArchetype(resolvedPack.archetypeId) : null) ??
    getArchetype(archetype.id) ??
    archetype;

  return {
    archetype: resolvedArchetype,
    pack: resolvedPack,
    manifest,
    moduleIds: resolvedPack?.moduleIds ?? moduleIds,
    adaptationId: resolvedPack?.adaptationId ?? archetype.defaultAdaptationId,
    mappingReason,
    intakeAnswers,
  };
}
