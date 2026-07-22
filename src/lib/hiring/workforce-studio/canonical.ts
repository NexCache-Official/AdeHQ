// Deterministic canonical serialization + hashing for Workforce Blueprint
// approval. The approval hash covers every provisionable and cost-relevant
// field so an approved blueprint can never drift silently from what was
// actually provisioned — any payload change requires a fresh approval.

import { createHash } from "crypto";

/** Recursively sort object keys so JSON.stringify is order-independent.
 * Arrays keep their order (order is semantically meaningful for seats/rooms). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}
