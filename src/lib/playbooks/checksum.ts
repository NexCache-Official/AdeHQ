import { createHash } from "crypto";

/** Stable JSON stringify with sorted object keys (arrays preserve order). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

/** SHA-256 hex digest of canonical JSON for playbook/procedure version checksums. */
export function stableChecksum(obj: unknown): string {
  return createHash("sha256").update(canonicalJson(obj)).digest("hex");
}
