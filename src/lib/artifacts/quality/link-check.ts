import type { QualityCheckResult } from "./schema-check";

const URL_RE = /https?:\/\/[^\s)"']+/gi;

/** Soft-check: ensure claimed URLs look well-formed (no fetch). */
export function linkCheck(canonical: unknown): QualityCheckResult {
  const errors: string[] = [];
  const text = JSON.stringify(canonical ?? {});
  const matches = text.match(URL_RE) ?? [];
  for (const url of matches) {
    try {
      const u = new URL(url);
      if (!u.hostname.includes(".")) {
        errors.push(`suspicious url host: ${url}`);
      }
    } catch {
      errors.push(`malformed url: ${url}`);
    }
  }
  return { check: "link", ok: errors.length === 0, errors };
}
