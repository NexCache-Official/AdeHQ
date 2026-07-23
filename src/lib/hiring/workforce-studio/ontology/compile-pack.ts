// Compile a CuratedPack (or ephemeral module set) into a TemplateManifest.

import type { TemplateManifest, TemplateSeatBlueprint } from "../templates/types";
import { getAdaptation } from "./adaptations";
import { getModule } from "./modules";
import type { CuratedPack, FunctionalModule, IndustryAdaptation } from "./types";

const SHARED_TEAM_SIZE = {
  id: "team_size_preference",
  prompt: "How big should this team start?",
  type: "single_select" as const,
  options: [
    { value: "lean", label: "Lean" },
    { value: "standard", label: "Standard" },
    { value: "scaled", label: "Scaled" },
  ],
  defaultValue: "lean",
};

function dedupeById<T extends { templateRoomId?: string; templateSeatId?: string; id?: string }>(
  items: T[],
  key: keyof T,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = String(item[key] ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

function applySeatOverlay(
  seat: TemplateSeatBlueprint,
  adaptation: IndustryAdaptation | undefined,
): TemplateSeatBlueprint {
  if (!adaptation) return seat;
  const overlay =
    adaptation.seatOverlays.find((o) => o.templateSeatId === seat.templateSeatId) ??
    adaptation.seatOverlays.find((o) => o.roleKey && o.roleKey === seat.roleKey);
  if (!overlay) return seat;
  return {
    ...seat,
    roleKey: overlay.roleKey ?? seat.roleKey,
    missionTemplate: overlay.missionTemplate ?? seat.missionTemplate,
    responsibilities: overlay.responsibilities ?? seat.responsibilities,
    successMetrics: overlay.successMetrics ?? seat.successMetrics,
    authorityPolicy: overlay.authorityPolicy ?? seat.authorityPolicy,
    operationalVariant: overlay.operationalVariant ?? seat.operationalVariant,
    communicationStyle: overlay.communicationStyle ?? seat.communicationStyle,
  };
}

function mergeModules(modules: FunctionalModule[]): {
  seats: TemplateSeatBlueprint[];
  rooms: FunctionalModule["rooms"];
  edges: FunctionalModule["edges"];
  outcomes: FunctionalModule["outcomes"];
  scalingRules: FunctionalModule["scalingRules"];
  firstMissionTasks: NonNullable<FunctionalModule["firstMissionTasks"]>;
  scenarios: NonNullable<FunctionalModule["scenarios"]>;
} {
  const seats = modules.flatMap((m) => m.seats);
  const rooms = dedupeById(
    modules.flatMap((m) => m.rooms),
    "templateRoomId",
  );
  const edges = modules.flatMap((m) => m.edges);
  const outcomes = modules.flatMap((m) => m.outcomes);
  const scalingRules = modules.flatMap((m) => m.scalingRules ?? []);
  const firstMissionTasks = modules.flatMap((m) => m.firstMissionTasks ?? []);
  const scenarios = modules.flatMap((m) => m.scenarios ?? []);
  // Prefer first occurrence of a seat id.
  const seatMap = new Map<string, TemplateSeatBlueprint>();
  for (const s of seats) {
    if (!seatMap.has(s.templateSeatId)) seatMap.set(s.templateSeatId, s);
  }
  return {
    seats: [...seatMap.values()],
    rooms,
    edges,
    outcomes,
    scalingRules,
    firstMissionTasks,
    scenarios,
  };
}

function filterEdgesToKnownSeats(
  edges: FunctionalModule["edges"],
  seatIds: Set<string>,
): FunctionalModule["edges"] {
  return edges.filter((e) => seatIds.has(e.fromSeatTemplateId) && seatIds.has(e.toSeatTemplateId));
}

function filterOutcomesToKnownSeats(
  outcomes: FunctionalModule["outcomes"],
  seatIds: Set<string>,
): FunctionalModule["outcomes"] {
  return outcomes.filter((o) => !o.ownerSeatTemplateId || seatIds.has(o.ownerSeatTemplateId));
}

/** Compile modules + adaptation into a TemplateManifest (no curated pack metadata). */
export function compileModulesToManifest(params: {
  key: string;
  version?: string;
  name: string;
  description: string;
  industry: string;
  moduleIds: string[];
  adaptationId: string;
  intakeQuestions?: TemplateManifest["intakeQuestions"];
  category?: string;
}): TemplateManifest {
  const modules = params.moduleIds
    .map((id) => getModule(id))
    .filter((m): m is FunctionalModule => Boolean(m));
  if (modules.length === 0) {
    throw new Error(`No modules resolved for pack "${params.key}".`);
  }
  const adaptation = getAdaptation(params.adaptationId);
  const merged = mergeModules(modules);
  let seats = merged.seats.map((s) => applySeatOverlay(s, adaptation));
  const seatIds = new Set(seats.map((s) => s.templateSeatId));

  let rooms = merged.rooms.map((room) => {
    const overlay = adaptation?.roomOverlays?.find((r) => r.templateRoomId === room.templateRoomId);
    return overlay
      ? { ...room, name: overlay.name ?? room.name, description: overlay.description ?? room.description }
      : room;
  });

  // Ensure every seat's primary room exists.
  for (const s of seats) {
    if (s.primaryRoomTemplateId && !rooms.some((r) => r.templateRoomId === s.primaryRoomTemplateId)) {
      rooms = [
        ...rooms,
        {
          templateRoomId: s.primaryRoomTemplateId,
          name: "Team",
          kind: "department",
          description: "Working room for this team.",
          visibility: "workspace",
        },
      ];
    }
  }

  const edges = filterEdgesToKnownSeats(merged.edges, seatIds);
  const outcomes = filterOutcomesToKnownSeats(merged.outcomes, seatIds);

  // Filter scaling-rule edges/seats similarly after merge; keep rules intact
  // but drop addEdges that reference unknown base seats unless those seats are added in the same rule.
  const scalingRules = (merged.scalingRules ?? []).map((rule) => {
    const addedIds = new Set([...(rule.addSeats ?? []).map((s) => s.templateSeatId), ...seatIds]);
    return {
      ...rule,
      addSeats: (rule.addSeats ?? []).map((s) => applySeatOverlay(s, adaptation)),
      addEdges: (rule.addEdges ?? []).filter(
        (e) => addedIds.has(e.fromSeatTemplateId) && addedIds.has(e.toSeatTemplateId),
      ),
      addOutcomes: (rule.addOutcomes ?? []).filter(
        (o) => !o.ownerSeatTemplateId || addedIds.has(o.ownerSeatTemplateId),
      ),
    };
  });

  const intakeQuestions = params.intakeQuestions?.length
    ? params.intakeQuestions
    : [SHARED_TEAM_SIZE];

  // Deduplicate intake by id.
  const intakeById = new Map(intakeQuestions.map((q) => [q.id, q]));
  if (!intakeById.has("team_size_preference")) intakeById.set("team_size_preference", SHARED_TEAM_SIZE);

  return {
    key: params.key,
    version: params.version ?? "1.0.0",
    name: params.name,
    description: params.description,
    industry: params.industry,
    intakeQuestions: [...intakeById.values()],
    baseSeats: seats,
    baseRooms: rooms,
    baseEdges: edges,
    baseOutcomes: outcomes,
    scalingRules,
    scenarios: merged.scenarios ?? [],
    firstMissionTasks:
      merged.firstMissionTasks.length > 0
        ? merged.firstMissionTasks
        : seats.slice(0, 2).map((s, i) => ({
            titleTemplate: `Kickoff priorities for ${s.roleKey.replace(/_/g, " ")}`,
            descriptionTemplate: `Confirm the top priorities: ${s.missionTemplate}`,
            ownerSeatTemplateId: s.templateSeatId,
            dueInDays: 3 + i,
          })),
  };
}

export function compilePackToManifest(pack: CuratedPack): TemplateManifest {
  const manifest = compileModulesToManifest({
    key: pack.key,
    version: pack.version,
    name: pack.name,
    description: pack.description,
    industry: pack.industry,
    moduleIds: pack.moduleIds,
    adaptationId: pack.adaptationId,
    intakeQuestions: pack.intakeQuestions,
  });
  // Stash category on industry-compatible field via description is wrong —
  // callers read category from CuratedPack. Attach as non-enumerated extension
  // by encoding in a comment-free way: TemplateManifest has no category field yet.
  return {
    ...manifest,
    // Prefer pack intake defaults as question defaults when provided.
    intakeQuestions: manifest.intakeQuestions.map((q) =>
      pack.intakeDefaults && pack.intakeDefaults[q.id] != null
        ? { ...q, defaultValue: pack.intakeDefaults[q.id] }
        : q,
    ),
  };
}

/** Ephemeral pack for diagnosis paths that don't match a curated key. */
export function compileEphemeralManifest(params: {
  key: string;
  name: string;
  description: string;
  industry: string;
  moduleIds: string[];
  adaptationId: string;
}): TemplateManifest {
  return compileModulesToManifest({
    ...params,
    version: "1.0.0-ephemeral",
    intakeQuestions: [SHARED_TEAM_SIZE],
  });
}
