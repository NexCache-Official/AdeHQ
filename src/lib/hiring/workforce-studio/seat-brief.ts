// Helpers for Team Reveal: job-brief synthesis, seat pruning, WH labels.

import type { AiEmployeeJobBrief } from "@/lib/hiring/types";
import type { WorkforceBlueprintPayload, WorkforceSeat, WorkHoursForecastBand } from "./types";
import { forecastWorkHours } from "./simulation";

export function seatToJobBrief(seat: WorkforceSeat): AiEmployeeJobBrief {
  return {
    roleTitle: seat.roleTitle,
    department: "Workforce Studio",
    domain: seat.operationalVariant || seat.roleKey.replace(/_/g, " "),
    mission: seat.mission,
    coreResponsibilities: seat.responsibilities.slice(0, 6),
    technicalFocus: [],
    businessFocus: seat.responsibilities.slice(0, 3),
    successMetrics: seat.successMetrics.slice(0, 4),
    communicationStyle: seat.communicationStyle || "Clear and professional.",
    personalityTraits: seat.personalityTraits.slice(0, 4),
    proactivityLevel: "balanced",
    qualityPreference: "balanced",
    seniorityLevel: seat.seniority,
    autonomyLevel:
      seat.authorityPolicy.email === "act_autonomously" ||
      seat.authorityPolicy.tasks === "act_autonomously"
        ? "high"
        : "balanced",
    approvalRules: Object.entries(seat.authorityPolicy)
      .filter(([, level]) => level === "act_with_approval")
      .map(([domain]) => `Ask before ${domain.replace(/_/g, " ")}`),
    toolsNeeded: [...seat.toolIds],
    assumptions: [],
    openQuestions: [],
  };
}

/** Remove seats (and clean rooms/edges/outcomes) — mirrors RosterEditor.removeSeat. */
export function pruneSeatsFromPayload(
  payload: WorkforceBlueprintPayload,
  keepSeatIds: Set<string>,
): WorkforceBlueprintPayload {
  const seats = payload.seats.filter((s) => keepSeatIds.has(s.id));
  const seatIds = new Set(seats.map((s) => s.id));
  const rooms = payload.rooms
    .map((r) => ({
      ...r,
      memberSeatIds: r.memberSeatIds.filter((id) => seatIds.has(id)),
    }))
    .filter((r) => r.memberSeatIds.length > 0);
  const roomIds = new Set(rooms.map((r) => r.id));
  return {
    ...payload,
    seats: seats.map((s) => ({
      ...s,
      primaryRoomId: s.primaryRoomId && roomIds.has(s.primaryRoomId) ? s.primaryRoomId : rooms[0]?.id,
      memberOfRoomIds: s.memberOfRoomIds.filter((id) => roomIds.has(id)),
    })),
    rooms,
    edges: payload.edges.filter((e) => seatIds.has(e.fromSeatId) && seatIds.has(e.toSeatId)),
    outcomes: payload.outcomes
      .map((o) =>
        o.ownerSeatId && !seatIds.has(o.ownerSeatId) ? { ...o, ownerSeatId: undefined } : o,
      )
      .filter((o) => !o.ownerSeatId || seatIds.has(o.ownerSeatId)),
  };
}

export function bandsBySeatId(seats: WorkforceSeat[]): Map<string, WorkHoursForecastBand> {
  return new Map(forecastWorkHours(seats).map((b) => [b.seatId, b]));
}

export function humanMappingReason(mappingReason?: string | null): string | null {
  if (!mappingReason) return null;
  // Hide raw legacy-pack jargon from customers.
  if (/legacy pack/i.test(mappingReason)) {
    return "Maya matched your business to a proven team system for this industry.";
  }
  const m = mappingReason.match(/→\s*(.+?)\s*pack/i);
  if (m) return `Maya matched your business to the ${m[1].trim()} team system.`;
  if (/ephemeral/i.test(mappingReason)) {
    return "Maya composed a custom team from the workstreams you described.";
  }
  return null;
}
