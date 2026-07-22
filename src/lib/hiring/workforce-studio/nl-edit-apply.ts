// Pure, dependency-free types + merge logic for Workforce Studio
// natural-language edits (PR-21D). No AI SDK imports here — this file must
// be safe to bundle into the client (the diff review + "Apply" action run
// entirely client-side against the already-fetched draft payload).

import { z } from "zod";
import { getAllRoles } from "@/lib/hiring/role-library";
import { uid } from "@/lib/utils";
import type { WorkforceBlueprintPayload, WorkforceSeat } from "./types";

// Field order here is deliberate, not cosmetic: structured-output models
// have measurably worse recall on nested-object array fields the later they
// appear in the schema (observed empirically against SiliconFlow — an
// "addOutcomes" request was reliably dropped to [] when it was the 4th
// field, and reliably filled correctly once moved to the 2nd). Keep
// "summary" first (it anchors the model's plan) and the most
// structurally-complex / easiest-to-drop array right after it.
export const nlEditSchema = z.object({
  summary: z.string().min(1).max(160).describe("One sentence describing exactly what you put in the arrays below — nothing more, nothing less."),
  addOutcomes: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        metric: z.string().min(1).max(160),
        target: z.string().min(1).max(160),
        // Deliberately required, no zod .default() — a .default() on an enum
        // nested inside an array item was empirically unreliable against the
        // SiliconFlow structured-output path (the model would consistently
        // divert to populating an unrelated field instead of addOutcomes).
        // The system prompt tells the model to always supply a value.
        checkpointCadence: z.enum(["daily", "weekly", "biweekly", "monthly"]),
      }),
    )
    .max(5)
    .default([])
    .describe(
      "NEW team-level goals to add, one entry per goal named in the instruction (e.g. 'add an outcome/goal/metric: ...'). This is the ONLY array to use for goal/outcome/metric requests — never use updateSeats or addSeats for these, and never leave this empty when the instruction names a goal to add.",
    ),
  addSeats: z
    .array(
      z.object({
        roleKey: z.string().min(1),
        operationalVariant: z.string().max(60).optional(),
        mission: z.string().min(1).max(400),
        primaryRoomName: z.string().max(80).optional(),
      }),
    )
    .max(10)
    .default([])
    .describe("NEW people/seats to hire onto the team. Use only when the instruction asks to add/hire a role, not for goals."),
  removeSeatIds: z.array(z.string()).max(10).default([]).describe("Exact seat ids of EXISTING seats to delete."),
  updateSeats: z
    .array(
      z.object({
        seatId: z.string().min(1),
        mission: z.string().max(400).optional(),
        operationalVariant: z.string().max(60).optional(),
        seniority: z.enum(["assistant", "specialist", "manager", "director", "advisor"]).optional(),
        modelMode: z.enum(["cheap", "balanced", "strong", "long_context", "coding", "creative"]).optional(),
      }),
    )
    .max(10)
    .default([])
    .describe(
      "Changes to an EXISTING named seat's own mission/seniority/model, referenced by its exact seat id. Do NOT use this for adding outcomes/goals, and do NOT touch a seat here just because an outcome instruction happens to mention a role or timeframe.",
    ),
});

// A deliberately narrow schema for instructions that are unambiguously
// "add an outcome/goal" and nothing else — no seat fields at all. Empirically,
// SiliconFlow's structured-output path reliably drops addOutcomes to []
// (while still narrating success in "summary") when it has to compete
// against 3 other array fields in the same schema; asking for outcomes in
// isolation resolves that reliably. nl-edit.ts picks this schema via a cheap
// keyword heuristic before falling back to the full nlEditSchema.
export const nlOutcomeOnlySchema = z.object({
  summary: z.string().min(1).max(160),
  addOutcomes: nlEditSchema.shape.addOutcomes,
});

export type NlEditProposal = z.infer<typeof nlEditSchema> & {
  /** Resolved server-side so the client never needs the role library to render the diff. */
  addSeatTitles: string[];
};

export type NlEditDiffOp =
  | { kind: "add_seat"; roleTitle: string; mission: string }
  | { kind: "remove_seat"; seatId: string; roleTitle: string }
  | { kind: "update_seat"; seatId: string; roleTitle: string; fields: string[] }
  | { kind: "add_outcome"; title: string };

/** Deterministically apply an already-reviewed proposal to a draft payload. */
export function applyNlEditProposal(
  payload: WorkforceBlueprintPayload,
  proposal: NlEditProposal,
): WorkforceBlueprintPayload {
  let next = payload;
  const roles = getAllRoles();

  if (proposal.addSeats.length) {
    const newSeats: WorkforceSeat[] = [];
    let rooms = next.rooms;
    for (const add of proposal.addSeats) {
      const role = roles.find((r) => r.roleKey === add.roleKey);
      if (!role) continue;
      const room = add.primaryRoomName ? rooms.find((r) => r.name.toLowerCase() === add.primaryRoomName!.toLowerCase()) : rooms[0];
      const seat: WorkforceSeat = {
        id: uid("seat"),
        roleKey: role.roleKey,
        roleTitle: role.title,
        operationalVariant: add.operationalVariant,
        seniority: "specialist",
        modelMode: role.defaultModelMode,
        communicationStyle: "Clear and professional.",
        personalityTraits: [],
        mission: add.mission,
        responsibilities: [...role.defaultResponsibilities],
        successMetrics: [...role.defaultSuccessMetrics],
        toolIds: [],
        authorityPolicy: { room_scope: "act_autonomously", tasks: "act_autonomously" },
        primaryRoomId: room?.id,
        memberOfRoomIds: [],
        source: "nl_edit",
      };
      newSeats.push(seat);
      if (room) {
        rooms = rooms.map((r) => (r.id === room.id ? { ...r, memberSeatIds: [...r.memberSeatIds, seat.id] } : r));
      }
    }
    next = { ...next, seats: [...next.seats, ...newSeats], rooms };
  }

  if (proposal.removeSeatIds.length) {
    const removeSet = new Set(proposal.removeSeatIds);
    next = {
      ...next,
      seats: next.seats.filter((s) => !removeSet.has(s.id)),
      rooms: next.rooms.map((r) => ({ ...r, memberSeatIds: r.memberSeatIds.filter((id) => !removeSet.has(id)) })),
      edges: next.edges.filter((e) => !removeSet.has(e.fromSeatId) && !removeSet.has(e.toSeatId)),
    };
  }

  if (proposal.updateSeats.length) {
    next = {
      ...next,
      seats: next.seats.map((seat) => {
        const update = proposal.updateSeats.find((u) => u.seatId === seat.id);
        if (!update) return seat;
        return {
          ...seat,
          ...(update.mission !== undefined ? { mission: update.mission } : {}),
          ...(update.operationalVariant !== undefined ? { operationalVariant: update.operationalVariant } : {}),
          ...(update.seniority !== undefined ? { seniority: update.seniority } : {}),
          ...(update.modelMode !== undefined ? { modelMode: update.modelMode } : {}),
          source: "nl_edit" as const,
        };
      }),
    };
  }

  if (proposal.addOutcomes.length) {
    next = {
      ...next,
      outcomes: [
        ...next.outcomes,
        ...proposal.addOutcomes.map((o) => ({
          id: uid("outcome"),
          title: o.title,
          metric: o.metric,
          target: o.target,
          checkpointCadence: o.checkpointCadence,
        })),
      ],
    };
  }

  return next;
}
