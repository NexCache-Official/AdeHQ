// ===========================================================================
// Maya Workforce Studio — core domain types.
//
// A WorkforceBlueprint is the durable, versioned artifact behind a designed
// team. Everything below is plain JSON-serializable data so it can round
// trip through jsonb columns (draft_payload / approved_payload) and through
// json-logic-js composition rules without adapters.
// ===========================================================================

import type { ModelMode } from "@/lib/ai/model-catalog";

export type BlueprintMode = "new_team";
export type BlueprintStatus =
  | "draft"
  | "approved"
  | "provisioning"
  | "active"
  | "superseded"
  | "archived";

/** Capability domains an authority level can be granted for — mirrors the
 * internal capability catalog (crm/email/tasks/drive/...) plus a generic
 * "room_scope" bucket for room-level read/post/manage authority. */
export type AuthorityDomain =
  | "crm"
  | "email"
  | "tasks"
  | "drive"
  | "artifact"
  | "social"
  | "calendar"
  | "investor"
  | "team"
  | "research"
  | "room_scope";

export type AuthorityLevel = "none" | "read" | "act_with_approval" | "act_autonomously";

/** Capability matrix — one row per domain a seat can touch. Compiled into
 * existing AdeHQ mechanisms (employee_tools.permission + approvalBeforeX
 * flags on AIEmployee.permissions) at provisioning time. */
export type AuthorityPolicy = Partial<Record<AuthorityDomain, AuthorityLevel>>;

export type CollaborationEdgeType =
  | "handoff"
  | "review"
  | "escalation"
  | "collaborates_with";

export type CollaborationContract = {
  /** e.g. "hands off drafts for review before external send" */
  description: string;
  triggersOn?: string;
  slaHours?: number;
};

export type CollaborationEdge = {
  id: string;
  type: CollaborationEdgeType;
  fromSeatId: string;
  toSeatId: string;
  contract: CollaborationContract;
};

/** A single AI seat instance — one row per hire, even when two seats share a
 * roleKey (e.g. "2 software engineers, one frontend one backend"). */
export type WorkforceSeat = {
  id: string;
  roleKey: string;
  roleTitle: string;
  /** Free-text specialization distinguishing seats that share a roleKey —
   * "Frontend", "Backend", "APAC coverage" — surfaced in the UI + brief. */
  operationalVariant?: string;
  seniority: "assistant" | "specialist" | "manager" | "director" | "advisor";
  modelMode: ModelMode;
  communicationStyle: string;
  personalityTraits: string[];
  mission: string;
  responsibilities: string[];
  successMetrics: string[];
  toolIds: string[];
  authorityPolicy: AuthorityPolicy;
  /** Room id (within this blueprint) this seat lands in by default. */
  primaryRoomId?: string;
  /** Additional room ids this seat is a member of. */
  memberOfRoomIds: string[];
  /** Set by the template/composition rules; freely editable after. */
  source: "template" | "manual" | "nl_edit";
};

export type WorkforceRoomKind = "department" | "project" | "leadership";

export type WorkforceRoomPlan = {
  id: string;
  name: string;
  kind: WorkforceRoomKind;
  description: string;
  visibility: "workspace" | "restricted" | "private";
  /** Seat ids that are members of this room. */
  memberSeatIds: string[];
  /** Human reference — planning-only, not provisioned as a real room member
   * (humans join AdeHQ rooms directly; this just informs Maya + simulation). */
  humanReferenceRoles: string[];
};

export type WorkforceOutcome = {
  id: string;
  title: string;
  metric: string;
  target: string;
  checkpointCadence: "daily" | "weekly" | "biweekly" | "monthly";
  ownerSeatId?: string;
};

/** Human role referenced for planning/simulation only — never provisioned. */
export type HumanReference = {
  id: string;
  title: string;
  roomIds: string[];
};

export type WorkforceBlueprintPayload = {
  templateKey: string;
  templateVersion: string;
  blueprintMode: BlueprintMode;
  companyProfileRevision: number | null;
  seats: WorkforceSeat[];
  rooms: WorkforceRoomPlan[];
  edges: CollaborationEdge[];
  outcomes: WorkforceOutcome[];
  humanReferences: HumanReference[];
  intakeAnswers: Record<string, unknown>;
  notes?: string;
};

export type WorkforceBlueprintRecord = {
  id: string;
  workspaceId: string;
  name: string;
  templateKey: string;
  templateVersion: string;
  blueprintMode: BlueprintMode;
  status: BlueprintStatus;
  schemaVersion: number;
  templateEngineVersion: string;
  compositionRulesVersion: string;
  simulationEngineVersion: string;
  revision: number;
  draftPayload: WorkforceBlueprintPayload;
  approvedRevision: number | null;
  approvedPayload: WorkforceBlueprintPayload | null;
  approvalHash: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  lockToken: string | null;
  lockedByUserId: string | null;
  lockAcquiredAt: string | null;
  lockExpiresAt: string | null;
  simulationReport: SimulationReport | null;
  simulatedAt: string | null;
  supersededByBlueprintId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Simulation (PR-21B)
// ---------------------------------------------------------------------------

export type SimulationFindingSeverity = "info" | "warning" | "critical";

export type SimulationFinding = {
  id: string;
  kind:
    | "coverage_gap"
    | "permission_missing"
    | "permission_excess"
    | "privacy_conflict"
    | "capacity_risk"
    | "structural";
  severity: SimulationFindingSeverity;
  message: string;
  seatIds?: string[];
  roomIds?: string[];
  domain?: AuthorityDomain;
};

/** One capability domain's slice of a seat's forecast WH — how much of the
 * seat's expected weekly work is attributable to each domain it's actually
 * authorized to touch (none-level domains never appear here). */
export type WorkHoursCapabilitySlice = {
  domain: AuthorityDomain;
  level: AuthorityLevel;
  expectedWh: number;
};

export type WorkHoursForecastBand = {
  seatId: string;
  roleTitle: string;
  lowWh: number;
  expectedWh: number;
  highWh: number;
  /** Breakdown of expectedWh across the seat's authorized capability
   * domains. Always sums to (approximately) expectedWh; empty only for a
   * seat with no granted authority at all. */
  byCapability: WorkHoursCapabilitySlice[];
};

export type SimulationScenarioResult = {
  scenarioId: string;
  title: string;
  passed: boolean;
  findings: SimulationFinding[];
};

export type SimulationReport = {
  generatedAt: string;
  blueprintRevision: number;
  simulationEngineVersion: string;
  scenarios: SimulationScenarioResult[];
  findings: SimulationFinding[];
  workHoursForecast: WorkHoursForecastBand[];
  totalExpectedWeeklyWh: number;
  narration: string | null;
  passed: boolean;
};

// ---------------------------------------------------------------------------
// Provisioning (PR-21B)
// ---------------------------------------------------------------------------

export type TeamHirePlanStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "compensating"
  | "compensated";

export type TeamHirePlanStepType =
  | "create_room"
  | "create_employee"
  | "grant_tools"
  | "add_room_member"
  | "create_collaboration_edge"
  | "create_outcome_task"
  | "create_artifact"
  | "first_mission_task"
  | "first_mission_message";

export type TeamHirePlanStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "compensated"
  | "skipped";

export type TeamHirePlanStep = {
  id: string;
  planId: string;
  stepIndex: number;
  stepType: TeamHirePlanStepType;
  status: TeamHirePlanStepStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  provenance: Record<string, unknown>;
  dependsOnStepIndexes: number[];
  attempts: number;
  lastError: string | null;
};

export type TeamHirePlanRecord = {
  id: string;
  workspaceId: string;
  blueprintId: string;
  blueprintRevision: number;
  approvalHash: string;
  idempotencyKey: string;
  status: TeamHirePlanStatus;
  totalSteps: number;
  completedSteps: number;
  error: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
