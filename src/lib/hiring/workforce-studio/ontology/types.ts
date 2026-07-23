// PR-22B — modular business ontology. Curated packs assemble archetypes +
// functional modules + industry adaptations, then compile to TemplateManifest
// so composer / simulate / provision stay unchanged.

import type { OperatingModel } from "../diagnosis-types";
import type {
  IntakeQuestion,
  ScalingRule,
  SimulationScenario,
  TemplateEdgeBlueprint,
  TemplateOutcomeBlueprint,
  TemplateRoomBlueprint,
  TemplateSeatBlueprint,
  FirstMissionTask,
} from "../templates/types";

export type PackCategory =
  | "commerce"
  | "hospitality"
  | "professional"
  | "technology"
  | "education_media"
  | "operational";

export type BusinessArchetype = {
  id: string;
  name: string;
  operatingModel: OperatingModel;
  description: string;
  /** Default modules for a lean starting team. */
  defaultModuleIds: string[];
  defaultAdaptationId: string;
  /** Keywords that boost this archetype in diagnosis mapping. */
  matchTerms: string[];
};

export type FunctionalModule = {
  id: string;
  name: string;
  description: string;
  seats: TemplateSeatBlueprint[];
  rooms: TemplateRoomBlueprint[];
  edges: TemplateEdgeBlueprint[];
  outcomes: TemplateOutcomeBlueprint[];
  /** Seats/rooms/edges only added when scaling rules fire. */
  scalingRules?: ScalingRule[];
  firstMissionTasks?: FirstMissionTask[];
  scenarios?: SimulationScenario[];
};

export type SeatAdaptationOverlay = {
  templateSeatId?: string;
  roleKey?: string;
  missionTemplate?: string;
  responsibilities?: string[];
  successMetrics?: string[];
  authorityPolicy?: TemplateSeatBlueprint["authorityPolicy"];
  operationalVariant?: string;
  communicationStyle?: string;
};

export type IndustryAdaptation = {
  id: string;
  name: string;
  description: string;
  seatOverlays: SeatAdaptationOverlay[];
  /** Optional room name/description overrides by templateRoomId. */
  roomOverlays?: Array<{ templateRoomId: string; name?: string; description?: string }>;
};

export type CuratedPack = {
  key: string;
  version: string;
  name: string;
  description: string;
  category: PackCategory;
  industry: string;
  archetypeId: string;
  moduleIds: string[];
  adaptationId: string;
  /** Extra intake questions beyond the shared team-size question. */
  intakeQuestions?: IntakeQuestion[];
  intakeDefaults?: Record<string, unknown>;
  /** When true, pack is listed in Starting points (all curated packs are). */
  publicStartingPoint?: boolean;
  /** Alias keys that also resolve to this pack (legacy PR-21 keys). */
  aliases?: string[];
};
