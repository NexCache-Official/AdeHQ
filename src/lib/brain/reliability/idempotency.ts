import { createHash } from "crypto";

/**
 * Stable idempotency key for a logical Brain step.
 * Same inputs → same key → at-most-once side effects.
 */
export function buildStepIdempotencyKey(parts: {
  workspaceId: string;
  brainRunId: string;
  capability: string;
  employeeId?: string | null;
  logicalStepKey: string;
}): string {
  const raw = [
    parts.workspaceId,
    parts.brainRunId,
    parts.capability,
    parts.employeeId ?? "",
    parts.logicalStepKey,
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
