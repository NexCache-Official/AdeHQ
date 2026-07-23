import { createHash } from "crypto";

/**
 * Deterministic idempotency key from stable string parts.
 * Empty / whitespace parts are dropped.
 */
export function buildIdempotencyKey(parts: string[]): string {
  const normalized = parts
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join("|");
  if (!normalized) {
    throw new Error("buildIdempotencyKey requires at least one non-empty part");
  }
  return createHash("sha256").update(normalized).digest("hex");
}
