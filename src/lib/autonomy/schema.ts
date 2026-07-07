// ===========================================================================
// Autonomy response schema — the structured shape the model returns each
// iteration. Kept separate from the chat ModelResponseSchema.
// ===========================================================================

import { z } from "zod";

export const AutonomyToolCallSchema = z.object({
  tool: z.string(),
  mode: z.enum(["preview", "execute"]).optional(),
  args: z.record(z.string(), z.unknown()).default({}),
});

export const AutonomyDecisionSchema = z.object({
  thought: z.string().default(""),
  status: z.enum(["continue", "done", "blocked"]).default("continue"),
  toolCalls: z.array(AutonomyToolCallSchema).default([]),
  report: z.string().optional(),
  plan: z.array(z.string()).optional(),
});

export type AutonomyDecisionObject = z.infer<typeof AutonomyDecisionSchema>;
