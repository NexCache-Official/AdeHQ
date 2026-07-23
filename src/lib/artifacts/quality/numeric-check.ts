import type { QualityCheckResult } from "./schema-check";

/** Flag non-finite numbers in workbook-like or metric payloads. */
export function numericCheck(canonical: unknown): QualityCheckResult {
  const errors: string[] = [];

  const walk = (value: unknown, path: string) => {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) errors.push(`${path}: non-finite number`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };

  walk(canonical, "$");
  return { check: "numeric", ok: errors.length === 0, errors };
}
