import type { JsonLogicRule } from "../json-logic";
import type {
  AuthorityPolicy,
  CollaborationEdgeType,
  SimulationFinding,
  WorkforceBlueprintPayload,
  WorkforceRoomKind,
} from "../types";
import type { ModelMode } from "@/lib/ai/model-catalog";

export type IntakeQuestionType = "single_select" | "multi_select" | "number" | "text";

export type IntakeQuestion = {
  id: string;
  prompt: string;
  type: IntakeQuestionType;
  options?: { value: string; label: string }[];
  defaultValue?: unknown;
  helpText?: string;
  /** JsonLogic condition over prior answers — question only shown when true
   * (or always shown when omitted). */
  appliesWhen?: JsonLogicRule;
};

export type TemplateSeatBlueprint = {
  /** Stable id within the template, e.g. "eng_frontend_1". Real seat ids are
   * generated fresh per blueprint at compose time. */
  templateSeatId: string;
  roleKey: string;
  operationalVariant?: string;
  seniority: "assistant" | "specialist" | "manager" | "director" | "advisor";
  modelMode: ModelMode;
  communicationStyle: string;
  personalityTraits: string[];
  missionTemplate: string;
  responsibilities: string[];
  successMetrics: string[];
  toolIds: string[];
  authorityPolicy: AuthorityPolicy;
  primaryRoomTemplateId?: string;
  memberOfRoomTemplateIds?: string[];
};

export type TemplateRoomBlueprint = {
  templateRoomId: string;
  name: string;
  kind: WorkforceRoomKind;
  description: string;
  visibility: "workspace" | "restricted" | "private";
  humanReferenceRoles?: string[];
};

export type TemplateEdgeBlueprint = {
  type: CollaborationEdgeType;
  fromSeatTemplateId: string;
  toSeatTemplateId: string;
  description: string;
  slaHours?: number;
};

export type TemplateOutcomeBlueprint = {
  title: string;
  metric: string;
  target: string;
  checkpointCadence: "daily" | "weekly" | "biweekly" | "monthly";
  ownerSeatTemplateId?: string;
};

/** A scaling rule adds additional seats/rooms/edges/outcomes when its
 * JsonLogic condition evaluates true against { answers, seatCounts }. */
export type ScalingRule = {
  id: string;
  description: string;
  condition: JsonLogicRule;
  addSeats?: TemplateSeatBlueprint[];
  addRooms?: TemplateRoomBlueprint[];
  addEdges?: TemplateEdgeBlueprint[];
  addOutcomes?: TemplateOutcomeBlueprint[];
};

export type SimulationScenarioCategory = "global" | "industry" | "permission_risk" | "failure";

export type SimulationScenario = {
  id: string;
  title: string;
  category: SimulationScenarioCategory;
  description: string;
  /** Pure check against the composed payload — returns findings (empty = pass). */
  check: (payload: WorkforceBlueprintPayload) => SimulationFinding[];
};

export type FirstMissionTask = {
  titleTemplate: string;
  descriptionTemplate: string;
  ownerSeatTemplateId: string;
  dueInDays: number;
};

export type TemplateManifest = {
  key: string;
  version: string;
  name: string;
  description: string;
  industry: string;
  intakeQuestions: IntakeQuestion[];
  baseSeats: TemplateSeatBlueprint[];
  baseRooms: TemplateRoomBlueprint[];
  baseEdges: TemplateEdgeBlueprint[];
  baseOutcomes: TemplateOutcomeBlueprint[];
  scalingRules: ScalingRule[];
  scenarios: SimulationScenario[];
  firstMissionTasks: FirstMissionTask[];
};
