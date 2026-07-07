// ===========================================================================
// Autonomy brain — the injectable model call. Real impl routes through
// Runtime V2 (generateObject); tests pass a scripted brain instead.
// ===========================================================================

import { generateObject } from "@/lib/ai/runtime";
import { AutonomyDecisionSchema } from "./schema";
import { buildAutonomySystemPrompt, buildAutonomyUserPrompt } from "./prompt";
import type { AutonomyBrain, AutonomyDecision } from "./types";

export type RuntimeBrainOptions = {
  workspaceId: string;
  employeeId: string;
  modelMode?: "cheap" | "balanced" | "strong" | "long_context" | "coding" | "creative";
  /** Test-only runtime override. */
  forceMode?: "on" | "off" | "shadow";
  timeoutMs?: number;
};

/** Build a runtime-backed brain bound to a workspace + employee. */
export function createRuntimeBrain(options: RuntimeBrainOptions): AutonomyBrain {
  return async (ctx): Promise<AutonomyDecision> => {
    const result = await generateObject<AutonomyDecision>(
      {
        workspaceId: options.workspaceId,
        employeeId: options.employeeId,
        capability: "reasoning",
        modelMode: options.modelMode ?? "balanced",
        requiresJson: true,
        schema: AutonomyDecisionSchema,
        system: buildAutonomySystemPrompt(ctx),
        prompt: buildAutonomyUserPrompt(ctx),
        temperature: 0.3,
        maxTokens: 1200,
        timeoutMs: options.timeoutMs ?? 45_000,
        metadata: { source: "autonomous_session" },
      },
      options.forceMode ? { forceMode: options.forceMode } : undefined,
    );

    const object = result.object;
    if (!object) {
      return {
        thought: "I could not produce a valid next step.",
        status: "blocked",
        toolCalls: [],
        report: "The model did not return a usable decision. Stopping to avoid looping.",
      };
    }

    return {
      thought: object.thought ?? "",
      status: object.status ?? "continue",
      toolCalls: (object.toolCalls ?? []).map((c) => ({
        tool: c.tool,
        mode: c.mode === "preview" ? "preview" : "execute",
        args: (c.args ?? {}) as Record<string, unknown>,
      })),
      report: object.report,
      plan: object.plan,
      usageCostUsd: result.usage?.totalCostUsd,
    };
  };
}

/** Estimated model cost per iteration from runtime usage (best-effort). */
export type BrainUsage = { costUsd: number };
