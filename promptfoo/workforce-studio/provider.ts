// Custom Promptfoo provider (PR-21E) — exercises the REAL Maya Workforce
// Studio natural-language edit code path (src/lib/hiring/workforce-studio/
// nl-edit.ts, backed by a live SiliconFlow call), not a mock. Each test case
// sends a free-text instruction; the provider composes a fresh fixture team,
// asks Maya to propose a diff, applies it exactly the way the client would,
// and reports a compact JSON summary for promptfoo's assertions to check —
// including whether the LLM was steered into anything the schema/apply path
// structurally can't do (excess permissions, oversized team growth), which
// is the point of the adversarial scenarios in promptfooconfig.yaml.
import "dotenv/config";
import path from "node:path";
import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse } from "promptfoo";
import { config as loadDotenv } from "dotenv";

// promptfoo runs this file directly under Node (via its internal tsx
// loader), outside the Next.js dev/build process — load .env.local
// ourselves so SILICONFLOW_API_KEY etc. are present before any AI SDK call.
loadDotenv({ path: path.resolve(__dirname, "../../.env.local") });

import { composeBlueprintFromTemplate } from "../../src/lib/hiring/workforce-studio/composer";
import { getTemplateManifest } from "../../src/lib/hiring/workforce-studio/templates/registry";
import { proposeNlEdit } from "../../src/lib/hiring/workforce-studio/nl-edit";
import { applyNlEditProposal } from "../../src/lib/hiring/workforce-studio/nl-edit-apply";
import type { WorkforceBlueprintPayload } from "../../src/lib/hiring/workforce-studio/types";

/** A realistic, moderately-sized fixture team — big enough that an
 * "oversized team" request is a meaningfully large ask relative to it, and
 * varied enough (mixed authority levels across domains) that an "excess
 * permission" request has real seats to target. */
function buildFixturePayload(): WorkforceBlueprintPayload {
  const manifest = getTemplateManifest("software_house");
  if (!manifest) throw new Error("software_house template not registered");
  return composeBlueprintFromTemplate(
    manifest,
    { team_size_preference: "scaled", needs_dedicated_devops: "yes", needs_customer_support: "yes" },
    null,
  );
}

type ProviderOutput = {
  declined: boolean;
  summary: string | null;
  addSeatCount: number;
  removeSeatCount: number;
  updateSeatCount: number;
  addOutcomeCount: number;
  seatsBefore: number;
  seatsAfter: number;
  /** True iff not a single seat's authorityPolicy differs before vs. after
   * applying the proposal — the NL-edit schema has no authorityPolicy field
   * on updateSeats, so this should ALWAYS be true no matter what an
   * adversarial instruction asks for. */
  authorityUnchanged: boolean;
  error?: string;
};

export default class WorkforceStudioNlEditProvider implements ApiProvider {
  constructor(private options: ProviderOptions) {}

  id(): string {
    return this.options?.id ?? "workforce-studio-nl-edit";
  }

  async callApi(prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const instruction = String(context?.vars?.instruction ?? prompt);
    const payload = buildFixturePayload();
    const beforeAuthority = new Map(payload.seats.map((s) => [s.id, JSON.stringify(s.authorityPolicy)]));

    let result: Awaited<ReturnType<typeof proposeNlEdit>>;
    try {
      result = await proposeNlEdit(instruction, payload);
    } catch (error) {
      const out: ProviderOutput = {
        declined: true,
        summary: null,
        addSeatCount: 0,
        removeSeatCount: 0,
        updateSeatCount: 0,
        addOutcomeCount: 0,
        seatsBefore: payload.seats.length,
        seatsAfter: payload.seats.length,
        authorityUnchanged: true,
        error: error instanceof Error ? error.message : String(error),
      };
      return { output: JSON.stringify(out) };
    }

    if (!result) {
      const out: ProviderOutput = {
        declined: true,
        summary: null,
        addSeatCount: 0,
        removeSeatCount: 0,
        updateSeatCount: 0,
        addOutcomeCount: 0,
        seatsBefore: payload.seats.length,
        seatsAfter: payload.seats.length,
        authorityUnchanged: true,
      };
      return { output: JSON.stringify(out) };
    }

    const applied = applyNlEditProposal(payload, result.proposal);
    const authorityUnchanged = applied.seats.every((seat) => {
      const before = beforeAuthority.get(seat.id);
      // A brand-new seat added by this proposal has no "before" to compare —
      // it can't represent an *escalation* of an existing seat's authority.
      if (before === undefined) return true;
      return before === JSON.stringify(seat.authorityPolicy);
    });

    const out: ProviderOutput = {
      declined: false,
      summary: result.proposal.summary,
      addSeatCount: result.ops.filter((op) => op.kind === "add_seat").length,
      removeSeatCount: result.ops.filter((op) => op.kind === "remove_seat").length,
      updateSeatCount: result.ops.filter((op) => op.kind === "update_seat").length,
      addOutcomeCount: result.ops.filter((op) => op.kind === "add_outcome").length,
      seatsBefore: payload.seats.length,
      seatsAfter: applied.seats.length,
      authorityUnchanged,
    };
    return { output: JSON.stringify(out) };
  }
}
