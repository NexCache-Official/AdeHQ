import {
  defaultModelModeForRole,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import type { RoutingPreference } from "@/lib/ai/intelligence-policy";
import type { EmployeeRoleKey } from "@/lib/types";
import {
  archetypeBestFor,
  archetypeHowIWork,
  archetypePitch,
  archetypeStrengths,
  archetypeWatchOuts,
  CANDIDATE_ARCHETYPES,
} from "./candidate-archetypes";
import { tierBadgeLabel } from "./candidate-display";
import { generateUniqueCandidateNames, sanitizeCandidateName } from "./candidate-names";
import type { AiEmployeeApplicant, AiEmployeeJobBrief, CandidateTier } from "./types";
import { getRoleByKey } from "./role-library";
import { hiringRoleToEmployeeRoleKey } from "./map-candidate";

function tierModelMode(tier: CandidateTier, roleKey: EmployeeRoleKey): ModelMode {
  const archetype = CANDIDATE_ARCHETYPES[tier];
  if (tier === "recommended") {
    return defaultModelModeForRole(roleKey);
  }
  return archetype.modelMode;
}

export type ApplicantCopy = Partial<
  Pick<
    AiEmployeeApplicant,
    | "name"
    | "title"
    | "personalityTags"
    | "strengths"
    | "watchOuts"
    | "bestFor"
    | "whyThisCandidate"
    | "candidatePitch"
    | "howIWork"
    | "communicationStyle"
    | "autonomyLevel"
    | "proactivityLevel"
    | "operatingStyle"
    | "routingBehavior"
    | "defaultIntelligence"
    | "commonModels"
  >
>;

function personaCopy(
  tier: CandidateTier,
  roleKey?: string | null,
): ApplicantCopy | undefined {
  const role = getRoleByKey(roleKey ?? undefined);
  if (!role) return undefined;
  const persona = role.candidatePersonas[tier];
  return {
    title: persona.title,
    strengths: persona.strengths,
    bestFor: persona.bestFor,
    whyThisCandidate: persona.whyRecommended ?? persona.bestFor,
  };
}

export function buildDeterministicApplicant(
  tier: CandidateTier,
  brief: AiEmployeeJobBrief,
  departmentId: string | null,
  roleKey?: string | null,
  copy?: ApplicantCopy,
  sessionScope?: string,
  nameOverride?: string,
): AiEmployeeApplicant {
  const archetype = CANDIDATE_ARCHETYPES[tier];
  const employeeRoleKey = hiringRoleToEmployeeRoleKey(roleKey, departmentId);
  const modelMode = tierModelMode(tier, employeeRoleKey);
  const resolvedModelId = resolveModel("siliconflow", modelMode);
  const personaDefaults = personaCopy(tier, roleKey);
  const title = copy?.title ?? personaDefaults?.title ?? brief.roleTitle;
  // "Maya" is reserved for the system Workforce Manager — never a hire candidate.
  const name = sanitizeCandidateName(copy?.name ?? nameOverride ?? "AI Candidate", nameOverride);
  const first = name.split(" ")[0] ?? name;
  const routingPreference = archetype.routingPreference;

  return {
    id: sessionScope ? `${sessionScope}:${tier}` : tier,
    tier,
    name,
    first,
    title,
    roleKey: roleKey ?? undefined,
    roleTitle: brief.roleTitle,
    modelMode,
    resolvedModelId,
    engineLabel: `${archetype.defaultIntelligence} intelligence`,
    operatingStyle: copy?.operatingStyle ?? archetype.operatingStyle,
    defaultIntelligence: copy?.defaultIntelligence ?? archetype.defaultIntelligence,
    routingPreference,
    routingBehavior: copy?.routingBehavior ?? archetype.routingBehavior,
    commonModels: copy?.commonModels ?? archetype.commonModels,
    weeklyWorkHours: 0,
    costIntensity: tier === "high_capacity" ? "low" : tier === "premium" ? "high" : "medium",
    speed: tier === "high_capacity" ? "fast" : tier === "premium" ? "slower" : "standard",
    quality: tier === "premium" ? "premium" : tier === "recommended" ? "high" : "standard",
    qualityLevel: tier === "premium" ? 3 : tier === "recommended" ? 2 : 1,
    speedLevel: tier === "high_capacity" ? 3 : tier === "premium" ? 1 : 2,
    costLevel: tier === "high_capacity" ? 1 : tier === "premium" ? 3 : 2,
    strengths: copy?.strengths ?? personaDefaults?.strengths ?? archetypeStrengths(tier, brief),
    watchOuts: copy?.watchOuts ?? archetypeWatchOuts(tier),
    bestFor: copy?.bestFor ?? personaDefaults?.bestFor ?? archetypeBestFor(tier, brief.roleTitle),
    whyThisCandidate:
      copy?.whyThisCandidate ??
      personaDefaults?.whyThisCandidate ??
      archetypeBestFor(tier, brief.roleTitle),
    recommended: tier === "recommended",
    personalityTags: copy?.personalityTags ?? archetype.personalityTags,
    candidatePitch:
      copy?.candidatePitch ?? archetypePitch(tier, brief.roleTitle, brief.domain),
    howIWork: copy?.howIWork ?? archetypeHowIWork(tier),
    communicationStyle:
      copy?.communicationStyle ??
      (tier === "premium" ? "Clear and executive-ready" : "Concise and collaborative"),
    autonomyLevel:
      copy?.autonomyLevel ?? (tier === "premium" ? "high" : "balanced"),
    proactivityLevel: copy?.proactivityLevel ?? (tier === "high_capacity" ? "high" : "balanced"),
    grad: archetype.grad,
    badge: tierBadgeLabel(tier),
    badgeKind: tier === "recommended" ? "rec" : "neutral",
    cap: 0,
  };
}

export function generateDeterministicCandidates(
  brief: AiEmployeeJobBrief,
  departmentId: string | null,
  roleKey?: string | null,
  copies?: Partial<Record<CandidateTier, ApplicantCopy>>,
  sessionScope?: string,
): AiEmployeeApplicant[] {
  const tiers: CandidateTier[] = ["high_capacity", "recommended", "premium"];
  const nameSeed = `${sessionScope ?? "local"}:${brief.roleTitle}:${roleKey ?? "custom"}`;
  const names = generateUniqueCandidateNames(nameSeed, tiers.length);

  return tiers.map((tier, index) =>
    buildDeterministicApplicant(
      tier,
      brief,
      departmentId,
      roleKey,
      copies?.[tier] ?? personaCopy(tier, roleKey),
      sessionScope,
      names[index],
    ),
  );
}

export function routingPreferenceForTier(tier: CandidateTier): RoutingPreference {
  return CANDIDATE_ARCHETYPES[tier].routingPreference;
}
