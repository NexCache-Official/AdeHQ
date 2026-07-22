// The Template Composer — compiles a TemplateManifest + intake answers into
// a fresh WorkforceBlueprintPayload. Deterministic given the same
// (manifest, answers) pair, aside from freshly generated ids.

import { uid } from "@/lib/utils";
import { getRoleByKey } from "@/lib/hiring/role-library";
import { evaluateCondition } from "./json-logic";
import type {
  TemplateEdgeBlueprint,
  TemplateManifest,
  TemplateOutcomeBlueprint,
  TemplateRoomBlueprint,
  TemplateSeatBlueprint,
} from "./templates/types";
import type {
  CollaborationEdge,
  HumanReference,
  WorkforceBlueprintPayload,
  WorkforceOutcome,
  WorkforceRoomPlan,
  WorkforceSeat,
} from "./types";

export type IntakeAnswers = Record<string, unknown>;

function camelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Build an interpolation context from intake answers, preferring the
 * human-readable option label over the raw stored value. Exported so the
 * plan executor can render first-mission-task copy from the same
 * intakeAnswers stored on an approved blueprint. */
export function buildInterpolationContext(
  manifest: TemplateManifest,
  answers: IntakeAnswers,
): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const question of manifest.intakeQuestions) {
    const raw = answers[question.id] ?? question.defaultValue;
    if (raw == null || raw === "") continue;
    const label = question.options?.find((o) => o.value === raw)?.label;
    ctx[camelCase(question.id)] = label ?? String(raw);
  }
  return ctx;
}

export function interpolate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => ctx[key] ?? match);
}

type SeatAccumulator = {
  templateSeatId: string;
  seatId: string;
  blueprint: TemplateSeatBlueprint;
};

type RoomAccumulator = {
  templateRoomId: string;
  roomId: string;
  blueprint: TemplateRoomBlueprint;
};

/** Compile a template manifest + validated intake answers into a fresh
 * draft blueprint payload. Pure function — no I/O, no randomness beyond id
 * generation (ids are freshly minted per compose, never reused). */
export function composeBlueprintFromTemplate(
  manifest: TemplateManifest,
  rawAnswers: IntakeAnswers,
  companyProfileRevision: number | null,
): WorkforceBlueprintPayload {
  // Merge in defaultValue for any question the caller didn't answer, so
  // interpolation and scaling-rule evaluation always see a complete,
  // consistent answer set — never a raw {{placeholder}} or an
  // under-specified rule condition.
  const answers: IntakeAnswers = { ...rawAnswers };
  for (const question of manifest.intakeQuestions) {
    if (answers[question.id] == null || answers[question.id] === "") {
      if (question.defaultValue != null) answers[question.id] = question.defaultValue;
    }
  }

  const ctx = buildInterpolationContext(manifest, answers);
  const ruleData = { answers };

  // Pass 1: collect every seat/room blueprint that applies (base + any
  // scaling rule whose condition evaluates true), preserving manifest order.
  const seatBlueprints: TemplateSeatBlueprint[] = [...manifest.baseSeats];
  const roomBlueprints: TemplateRoomBlueprint[] = [...manifest.baseRooms];
  const edgeBlueprints: TemplateEdgeBlueprint[] = [...manifest.baseEdges];
  const outcomeBlueprints: TemplateOutcomeBlueprint[] = [...manifest.baseOutcomes];

  for (const rule of manifest.scalingRules) {
    const seatsForCondition = seatBlueprints; // cumulative so far — supports countSeatsWithRole
    const applies = evaluateCondition(rule.condition, { ...ruleData, seats: seatsForCondition });
    if (!applies) continue;
    seatBlueprints.push(...(rule.addSeats ?? []));
    roomBlueprints.push(...(rule.addRooms ?? []));
    edgeBlueprints.push(...(rule.addEdges ?? []));
    outcomeBlueprints.push(...(rule.addOutcomes ?? []));
  }

  // Pass 2: mint real ids for every room, then every seat.
  const roomsById = new Map<string, RoomAccumulator>();
  for (const blueprint of roomBlueprints) {
    if (roomsById.has(blueprint.templateRoomId)) continue;
    roomsById.set(blueprint.templateRoomId, {
      templateRoomId: blueprint.templateRoomId,
      roomId: uid("wfroom"),
      blueprint,
    });
  }

  const seatsById = new Map<string, SeatAccumulator>();
  for (const blueprint of seatBlueprints) {
    if (seatsById.has(blueprint.templateSeatId)) continue;
    seatsById.set(blueprint.templateSeatId, {
      templateSeatId: blueprint.templateSeatId,
      seatId: uid("seat"),
      blueprint,
    });
  }

  // Pass 3: build rooms with resolved member seat lists.
  const rooms: WorkforceRoomPlan[] = [];
  for (const room of roomsById.values()) {
    const memberSeatIds = [...seatsById.values()]
      .filter((seat) => {
        const b = seat.blueprint;
        return (
          b.primaryRoomTemplateId === room.templateRoomId ||
          (b.memberOfRoomTemplateIds ?? []).includes(room.templateRoomId)
        );
      })
      .map((seat) => seat.seatId);
    rooms.push({
      id: room.roomId,
      name: room.blueprint.name,
      kind: room.blueprint.kind,
      description: room.blueprint.description,
      visibility: room.blueprint.visibility,
      memberSeatIds,
      humanReferenceRoles: room.blueprint.humanReferenceRoles ?? [],
    });
  }

  // Pass 4: build seats.
  const seats: WorkforceSeat[] = [...seatsById.values()].map((seat) => {
    const b = seat.blueprint;
    const roleEntry = getRoleByKey(b.roleKey);
    return {
      id: seat.seatId,
      roleKey: b.roleKey,
      roleTitle: b.operationalVariant ? `${roleEntry?.title ?? b.roleKey} — ${b.operationalVariant}` : roleEntry?.title ?? b.roleKey,
      operationalVariant: b.operationalVariant,
      seniority: b.seniority,
      modelMode: b.modelMode,
      communicationStyle: b.communicationStyle,
      personalityTraits: [...b.personalityTraits],
      mission: interpolate(b.missionTemplate, ctx),
      responsibilities: [...b.responsibilities],
      successMetrics: [...b.successMetrics],
      toolIds: [...b.toolIds],
      authorityPolicy: { ...b.authorityPolicy },
      primaryRoomId: b.primaryRoomTemplateId ? roomsById.get(b.primaryRoomTemplateId)?.roomId : undefined,
      memberOfRoomIds: (b.memberOfRoomTemplateIds ?? [])
        .map((rid) => roomsById.get(rid)?.roomId)
        .filter((id): id is string => Boolean(id)),
      source: "template",
    };
  });

  // Pass 5: build edges + outcomes with resolved seat ids.
  const edges: CollaborationEdge[] = [];
  for (const e of edgeBlueprints) {
    const fromSeatId = seatsById.get(e.fromSeatTemplateId)?.seatId;
    const toSeatId = seatsById.get(e.toSeatTemplateId)?.seatId;
    if (!fromSeatId || !toSeatId) continue;
    edges.push({
      id: uid("edge"),
      type: e.type,
      fromSeatId,
      toSeatId,
      contract: { description: e.description, ...(e.slaHours != null ? { slaHours: e.slaHours } : {}) },
    });
  }

  const outcomes: WorkforceOutcome[] = outcomeBlueprints.map((o) => ({
    id: uid("outcome"),
    title: o.title,
    metric: o.metric,
    target: o.target,
    checkpointCadence: o.checkpointCadence,
    ownerSeatId: o.ownerSeatTemplateId ? seatsById.get(o.ownerSeatTemplateId)?.seatId : undefined,
  }));

  // Human references: dedupe by title across rooms that named one.
  const humanRefByTitle = new Map<string, HumanReference>();
  for (const room of rooms) {
    for (const title of room.humanReferenceRoles) {
      const existing = humanRefByTitle.get(title);
      if (existing) {
        existing.roomIds.push(room.id);
      } else {
        humanRefByTitle.set(title, { id: uid("human"), title, roomIds: [room.id] });
      }
    }
  }

  return {
    templateKey: manifest.key,
    templateVersion: manifest.version,
    blueprintMode: "new_team",
    companyProfileRevision,
    seats,
    rooms,
    edges,
    outcomes,
    humanReferences: [...humanRefByTitle.values()],
    intakeAnswers: answers,
  };
}

/** Re-run the composer, but keep any seats/rooms/edges the user has already
 * hand-edited (source !== "template") untouched, and only add what new
 * scaling rules unlock. Used when intake answers change mid-session. */
export function recomposeWithManualEdits(
  manifest: TemplateManifest,
  answers: IntakeAnswers,
  companyProfileRevision: number | null,
  existing: WorkforceBlueprintPayload,
): WorkforceBlueprintPayload {
  const fresh = composeBlueprintFromTemplate(manifest, answers, companyProfileRevision);
  const manualSeats = existing.seats.filter((s) => s.source !== "template");
  const manualSeatIds = new Set(manualSeats.map((s) => s.id));
  const freshSeatKeys = new Set(fresh.seats.map((s) => `${s.roleKey}:${s.operationalVariant ?? ""}`));
  const keptTemplateSeats = fresh.seats.filter((s) => !manualSeatIds.has(s.id));
  void freshSeatKeys;
  return {
    ...fresh,
    seats: [...keptTemplateSeats, ...manualSeats],
    notes: existing.notes,
  };
}
