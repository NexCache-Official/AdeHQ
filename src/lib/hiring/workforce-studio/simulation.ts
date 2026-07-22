// Simulation engine (PR-21B) — validates a composed blueprint against
// structural, coverage, and permission/privacy rules (missing AND excess),
// forecasts a rough weekly Work Hours band per seat, and (optionally) adds
// one cheap-LLM narration on top of the deterministic findings. Pure/sync
// core so it's fully unit-testable without any network calls.

import type { SimulationScenario } from "./templates/types";
import { SIMULATION_ENGINE_VERSION } from "./blueprint-service";
import type {
  AuthorityDomain,
  AuthorityLevel,
  SimulationFinding,
  SimulationReport,
  SimulationScenarioResult,
  WorkforceBlueprintPayload,
  WorkforceSeat,
  WorkHoursCapabilitySlice,
  WorkHoursForecastBand,
} from "./types";

// ---------------------------------------------------------------------------
// Global scenarios — apply to every template, regardless of industry.
// ---------------------------------------------------------------------------

function globalScenarios(): SimulationScenario[] {
  return [
    {
      id: "global_orphan_seat",
      title: "Seat with no room",
      category: "global",
      description: "Every seat should belong to at least one room to do any work.",
      check(payload) {
        const roomedSeatIds = new Set(payload.rooms.flatMap((r) => r.memberSeatIds));
        return payload.seats
          .filter((s) => !roomedSeatIds.has(s.id))
          .map<SimulationFinding>((s) => ({
            id: `global_orphan_seat_${s.id}`,
            kind: "coverage_gap",
            severity: "critical",
            message: `${s.roleTitle} isn't a member of any room — they have nowhere to work.`,
            seatIds: [s.id],
          }));
      },
    },
    {
      id: "global_empty_room",
      title: "Room with no members",
      category: "global",
      description: "A room with zero seats is dead weight in the plan.",
      check(payload) {
        return payload.rooms
          .filter((r) => r.memberSeatIds.length === 0)
          .map<SimulationFinding>((r) => ({
            id: `global_empty_room_${r.id}`,
            kind: "coverage_gap",
            severity: "warning",
            message: `Room "${r.name}" has no seats assigned yet.`,
            roomIds: [r.id],
          }));
      },
    },
    {
      id: "global_dangling_edge",
      title: "Collaboration edge references a missing seat",
      category: "global",
      description: "Defensive check after manual edits — every edge must reference two real seats.",
      check(payload) {
        const seatIds = new Set(payload.seats.map((s) => s.id));
        return payload.edges
          .filter((e) => !seatIds.has(e.fromSeatId) || !seatIds.has(e.toSeatId))
          .map<SimulationFinding>((e) => ({
            id: `global_dangling_edge_${e.id}`,
            kind: "structural",
            severity: "critical",
            message: `A ${e.type} edge references a seat that no longer exists — remove or re-point it.`,
          }));
      },
    },
    {
      id: "global_no_room_scope",
      title: "Seat can't act in its own room",
      category: "permission_risk",
      description: "A seat with no room_scope authority can't post or act in the room it's assigned to.",
      check(payload) {
        return payload.seats
          .filter((s) => s.primaryRoomId && (!s.authorityPolicy.room_scope || s.authorityPolicy.room_scope === "none"))
          .map<SimulationFinding>((s) => ({
            id: `global_no_room_scope_${s.id}`,
            kind: "permission_missing",
            severity: "warning",
            message: `${s.roleTitle} has no room authority — grant at least read access to their primary room.`,
            seatIds: [s.id],
            domain: "room_scope",
          }));
      },
    },
    {
      id: "global_email_without_approval",
      title: "Autonomous email sending with no approval gate",
      category: "permission_risk",
      description: "Sending email autonomously (no human review) is excess authority for most seats — AdeHQ's default is approval-before-send.",
      check(payload) {
        return payload.seats
          .filter((s) => s.authorityPolicy.email === "act_autonomously" && s.seniority !== "director")
          .map<SimulationFinding>((s) => ({
            id: `global_email_excess_${s.id}`,
            kind: "permission_excess",
            severity: "warning",
            message: `${s.roleTitle} can send email with no approval gate — consider "act with approval" instead.`,
            seatIds: [s.id],
            domain: "email",
          }));
      },
    },
    {
      id: "global_no_outcome_owner",
      title: "Outcome with no owner",
      category: "global",
      description: "An outcome nobody owns won't get tracked week to week.",
      check(payload) {
        return payload.outcomes
          .filter((o) => !o.ownerSeatId)
          .map<SimulationFinding>((o) => ({
            id: `global_no_outcome_owner_${o.id}`,
            kind: "coverage_gap",
            severity: "info",
            message: `Outcome "${o.title}" has no owner seat assigned.`,
          }));
      },
    },
    {
      id: "global_duplicate_role_no_variant",
      title: "Duplicate roles without a distinguishing variant",
      category: "global",
      description: "Two seats with the same role and no operational variant may confuse handoffs.",
      check(payload) {
        const byRole = new Map<string, WorkforceSeat[]>();
        for (const seat of payload.seats) {
          const list = byRole.get(seat.roleKey) ?? [];
          list.push(seat);
          byRole.set(seat.roleKey, list);
        }
        const findings: SimulationFinding[] = [];
        for (const [roleKey, seats] of byRole) {
          if (seats.length < 2) continue;
          const undistinguished = seats.filter((s) => !s.operationalVariant?.trim());
          if (undistinguished.length >= 2) {
            findings.push({
              id: `global_dup_role_${roleKey}`,
              kind: "structural",
              severity: "info",
              message: `${undistinguished.length} seats share the "${roleKey}" role with no distinguishing focus — consider giving each an operational variant (e.g. frontend/backend).`,
              seatIds: undistinguished.map((s) => s.id),
            });
          }
        }
        return findings;
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Work Hours forecast — a lightweight, clearly-labeled heuristic band per
// seat (not the calibrated production Work Hours meter — see
// scripts/test-work-hours-calibration.ts for that system). Gives Maya and
// the admin a rough weekly capacity sense before approval.
// ---------------------------------------------------------------------------

const BASE_WH_BY_SENIORITY: Record<WorkforceSeat["seniority"], number> = {
  assistant: 14,
  specialist: 24,
  manager: 20,
  director: 16,
  advisor: 10,
};

const MODEL_MODE_FACTOR: Record<string, number> = {
  cheap: 0.75,
  balanced: 1,
  strong: 1.15,
  long_context: 1.05,
  coding: 1.1,
  creative: 1,
};

// Relative work-intensity weight per capability domain — how much of a
// seat's time a domain typically consumes when the seat is authorized to
// touch it, before the authority-level multiplier below. Purely a labeling
// heuristic for the pre-approval forecast, not a calibrated system.
const CAPABILITY_DOMAIN_WEIGHT: Record<AuthorityDomain, number> = {
  room_scope: 0.5,
  tasks: 1.4,
  email: 1.3,
  crm: 1.2,
  research: 1.1,
  artifact: 1.0,
  social: 0.9,
  drive: 0.8,
  investor: 0.7,
  calendar: 0.6,
  team: 0.5,
};

// How much of the domain's full weight actually applies at each authority
// level — a "read"-only grant costs far less time than acting on it.
const AUTHORITY_LEVEL_MULTIPLIER: Record<AuthorityLevel, number> = {
  none: 0,
  read: 0.3,
  act_with_approval: 0.7,
  act_autonomously: 1,
};

function capabilityBreakdown(seat: WorkforceSeat, expectedWh: number): WorkHoursCapabilitySlice[] {
  const active = (Object.entries(seat.authorityPolicy) as [AuthorityDomain, AuthorityLevel | undefined][])
    .filter(([, level]) => level && level !== "none")
    .map(([domain, level]) => ({
      domain,
      level: level as AuthorityLevel,
      weight: CAPABILITY_DOMAIN_WEIGHT[domain] * AUTHORITY_LEVEL_MULTIPLIER[level as AuthorityLevel],
    }));

  const totalWeight = active.reduce((sum, a) => sum + a.weight, 0);
  if (totalWeight <= 0) return [];

  return active.map((a) => ({
    domain: a.domain,
    level: a.level,
    expectedWh: Math.round(((a.weight / totalWeight) * expectedWh) * 10) / 10,
  }));
}

export function forecastWorkHours(seats: WorkforceSeat[]): WorkHoursForecastBand[] {
  return seats.map((seat) => {
    const base = BASE_WH_BY_SENIORITY[seat.seniority] * (MODEL_MODE_FACTOR[seat.modelMode] ?? 1);
    const expectedWh = Math.round(base * 10) / 10;
    return {
      seatId: seat.id,
      roleTitle: seat.roleTitle,
      lowWh: Math.round(base * 0.7 * 10) / 10,
      expectedWh,
      highWh: Math.round(base * 1.4 * 10) / 10,
      byCapability: capabilityBreakdown(seat, expectedWh),
    };
  });
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

function severityRank(s: SimulationFinding["severity"]): number {
  return s === "critical" ? 0 : s === "warning" ? 1 : 2;
}

export function runSimulation(
  payload: WorkforceBlueprintPayload,
  templateScenarios: SimulationScenario[],
  blueprintRevision: number,
): SimulationReport {
  const scenarios = [...globalScenarios(), ...templateScenarios];
  const scenarioResults: SimulationScenarioResult[] = scenarios.map((scenario) => {
    const findings = scenario.check(payload);
    return {
      scenarioId: scenario.id,
      title: scenario.title,
      passed: findings.every((f) => f.severity !== "critical"),
      findings,
    };
  });

  const findings = scenarioResults
    .flatMap((r) => r.findings)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const workHoursForecast = forecastWorkHours(payload.seats);
  const totalExpectedWeeklyWh = Math.round(workHoursForecast.reduce((sum, b) => sum + b.expectedWh, 0) * 10) / 10;

  return {
    generatedAt: new Date().toISOString(),
    blueprintRevision,
    simulationEngineVersion: SIMULATION_ENGINE_VERSION,
    scenarios: scenarioResults,
    findings,
    workHoursForecast,
    totalExpectedWeeklyWh,
    narration: null,
    passed: findings.every((f) => f.severity !== "critical"),
  };
}

export function authorityLevelRank(level: AuthorityLevel | undefined): number {
  switch (level) {
    case "act_autonomously":
      return 3;
    case "act_with_approval":
      return 2;
    case "read":
      return 1;
    default:
      return 0;
  }
}
