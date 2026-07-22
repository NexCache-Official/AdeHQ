// Natural-language blueprint edits (PR-21D) — server-side proposal only.
// Maya proposes a small, typed diff against the current draft — never a
// full payload rewrite — so every change is reviewable, revertible, and
// safe to merge deterministically on the client (see nl-edit-apply.ts,
// which is the client-safe half of this feature — no AI SDK imports there).

import { generateObject } from "ai";
import { getTimeoutMs, resolveModel } from "@/lib/ai/model-catalog";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { getAllRoles } from "@/lib/hiring/role-library";
import { nlEditSchema, nlOutcomeOnlySchema, type NlEditDiffOp, type NlEditProposal } from "./nl-edit-apply";
import type { WorkforceBlueprintPayload } from "./types";

export type { NlEditDiffOp, NlEditProposal } from "./nl-edit-apply";
export { applyNlEditProposal } from "./nl-edit-apply";

// Use the "strong" tier here, not "cheap"/"balanced" — this edits the
// actual shape of a team (seats, authority, outcomes), so correctness on a
// nested, multi-field schema matters more than shaving cost on an
// admin-initiated, infrequent action. In practice the cheaper tier's model
// was both measurably slower AND materially less reliable at this schema —
// it isn't a cost/latency tradeoff in this case, "strong" wins on both
// counts. Timeout still budgets generously (60s) for provider-side
// variance; the UI shows a "this can take up to a minute" hint while
// waiting.
const MODEL_MODE = "strong" as const;
const TIMEOUT_MS = getTimeoutMs("strong");

const OUTCOME_KEYWORDS = /\b(outcome|goal|kpi|target metric|success metric)\b/i;
const NON_OUTCOME_KEYWORDS =
  /\b(seat|hire|fire|engineer|manager|director|specialist|advisor|assistant|role|employee|person|remove|delete|authority|permission|access|autonomous|approval|room|mission)\b/i;

/**
 * Cheap, deterministic dispatch — no LLM call. Empirically, SiliconFlow's
 * structured-output path reliably drops "addOutcomes" to [] (while still
 * narrating success) when that array has to compete against 3 other array
 * fields in the same schema; asking for an outcome in complete isolation
 * (nlOutcomeOnlySchema) resolves that reliably. So instructions that are
 * unambiguously outcome-only skip the seat-aware schema entirely — this is
 * also strictly cheaper (smaller schema, no role/seat context needed).
 */
function looksOutcomeOnly(instruction: string): boolean {
  return OUTCOME_KEYWORDS.test(instruction) && !NON_OUTCOME_KEYWORDS.test(instruction);
}

/**
 * Turn a free-text instruction into a reviewable diff against the current
 * draft. Returns null (never throws to the caller) if the LLM is
 * unavailable, times out, or the model proposes nothing actionable.
 */
export async function proposeNlEdit(
  instruction: string,
  payload: WorkforceBlueprintPayload,
): Promise<{ proposal: NlEditProposal; ops: NlEditDiffOp[] } | null> {
  if (!isSiliconFlowConfigured()) return null;
  const trimmed = instruction.trim();
  if (!trimmed) return null;

  try {
    if (looksOutcomeOnly(trimmed)) {
      const outcomeResult = await proposeOutcomeOnlyEdit(trimmed);
      if (outcomeResult) return outcomeResult;
      // Fall through to the full schema below — a false-positive keyword
      // match (or a genuinely mixed instruction) still deserves a real try.
    }
    return await proposeFullEdit(trimmed, payload);
  } catch (error) {
    console.warn("[AdeHQ workforce-studio] NL edit proposal failed", error);
    return null;
  }
}

async function proposeOutcomeOnlyEdit(
  instruction: string,
): Promise<{ proposal: NlEditProposal; ops: NlEditDiffOp[] } | null> {
  const modelId = resolveModel("siliconflow", MODEL_MODE);
  const objectPromise = generateObject({
    model: siliconFlowChatModel(modelId),
    schema: nlOutcomeOnlySchema,
    system: `You are Maya, AdeHQ's AI Workforce Manager. An admin gave you an instruction to add a team-level outcome (a measurable goal) to an existing team. Split it into: "title" (a short 2-6 word label), "metric" (what is measured — the specific number/quantity/rate named), and "target" (the goal value/threshold named). Example: "Add an outcome: ship weekly releases with less than 3 days lead time" → title: "Weekly release cadence", metric: "Release lead time", target: "Under 3 days, shipped weekly", checkpointCadence: "weekly". If the instruction doesn't actually name a concrete goal (e.g. it's vague, like "make outcomes better"), return an empty addOutcomes array and a summary saying why.`,
    prompt: `Instruction: "${instruction}"`,
    maxOutputTokens: 400,
    providerOptions: siliconFlowProviderOptions(modelId),
  });

  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  const result = await Promise.race([objectPromise, timeoutPromise]);
  if (!result) return null;

  const proposalRaw = result.object;
  const ops: NlEditDiffOp[] = proposalRaw.addOutcomes.map((o) => ({ kind: "add_outcome" as const, title: o.title }));
  if (ops.length === 0) return null;

  return {
    proposal: { ...proposalRaw, addSeats: [], removeSeatIds: [], updateSeats: [], addSeatTitles: [] },
    ops,
  };
}

async function proposeFullEdit(
  instruction: string,
  payload: WorkforceBlueprintPayload,
): Promise<{ proposal: NlEditProposal; ops: NlEditDiffOp[] } | null> {
  const roles = getAllRoles();
  const roleContext = roles.map((r) => `${r.roleKey} (${r.title})`).join(", ");
  const seatContext = payload.seats
    .map((s) => `${s.id}: ${s.roleTitle}${s.operationalVariant ? ` — ${s.operationalVariant}` : ""}`)
    .join("\n");
  const roomContext = payload.rooms.map((r) => r.name).join(", ");

  const modelId = resolveModel("siliconflow", MODEL_MODE);
  const objectPromise = generateObject({
    model: siliconFlowChatModel(modelId),
    schema: nlEditSchema,
    system: `You are Maya, AdeHQ's AI Workforce Manager, editing an existing team design (a "blueprint") on behalf of an admin. AdeHQ AI employees do real work — CRM, email, tasks, drive, code, research — inside governed rooms.

You propose a SMALL, TYPED DIFF against the current team. You never rewrite the whole team. Only include operations the instruction actually asks for — leave everything else untouched (empty arrays for anything not requested).

Rules:
1. To add a seat, pick the closest roleKey from the provided role library list — never invent a roleKey.
2. To remove or update a seat, use the exact seat id from the "Current seats" list — never invent an id.
3. Keep missions concrete and specific to this team's context, one or two sentences.
4. If the instruction is ambiguous, generic, or requests something outside seats/outcomes (e.g. changing billing), return empty arrays and a summary explaining you can't do that here. This includes vague, open-ended requests like "make this team better", "improve things", or "optimize this" that don't name a specific role, person, or outcome to add, remove, or change — do NOT guess what the admin might want in that case, even if you can think of a plausible improvement. Only act when the instruction names something concrete.
5. To add an outcome, split the instruction into: "title" (a short 2-6 word label), "metric" (what is measured), and "target" (the goal value/threshold named). Never leave addOutcomes empty when the instruction explicitly asks to add an outcome/goal/metric.
6. An "add an outcome" instruction is ONLY about the addOutcomes array. It NEVER implies changing any seat's seniority, mission, or anything else — an outcome is a team-level goal, not a person. If the instruction only asks to add an outcome, updateSeats and addSeats MUST both be []. Do not "assign an owner" or "promote someone" for an outcome unless the instruction separately and explicitly asks for a seat change.
7. Your "summary" field must accurately describe ONLY the operations you actually populated in addSeats/removeSeatIds/updateSeats/addOutcomes. Never describe an action in the summary that isn't reflected in one of those arrays, and never populate an array with something the instruction didn't ask for.`,
    prompt: [
      `Instruction: "${instruction}"`,
      `Available roles: ${roleContext}`,
      `Current rooms: ${roomContext}`,
      `Current seats:\n${seatContext}`,
    ].join("\n\n"),
    maxOutputTokens: 900,
    providerOptions: siliconFlowProviderOptions(modelId),
  });

  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  const result = await Promise.race([objectPromise, timeoutPromise]);
  if (!result) return null;

  const proposalRaw = result.object;
  const addSeatTitles = proposalRaw.addSeats.map((s) => roles.find((r) => r.roleKey === s.roleKey)?.title ?? s.roleKey);

  const ops: NlEditDiffOp[] = [];
  proposalRaw.addSeats.forEach((s, i) => {
    ops.push({ kind: "add_seat", roleTitle: addSeatTitles[i], mission: s.mission });
  });
  for (const seatId of proposalRaw.removeSeatIds) {
    const seat = payload.seats.find((s) => s.id === seatId);
    if (seat) ops.push({ kind: "remove_seat", seatId, roleTitle: seat.roleTitle });
  }
  for (const update of proposalRaw.updateSeats) {
    const seat = payload.seats.find((s) => s.id === update.seatId);
    if (!seat) continue;
    const fields = Object.keys(update).filter((k) => k !== "seatId" && update[k as keyof typeof update] !== undefined);
    if (fields.length) ops.push({ kind: "update_seat", seatId: update.seatId, roleTitle: seat.roleTitle, fields });
  }
  for (const outcome of proposalRaw.addOutcomes) {
    ops.push({ kind: "add_outcome", title: outcome.title });
  }

  if (ops.length === 0) return null;

  return { proposal: { ...proposalRaw, addSeatTitles }, ops };
}
