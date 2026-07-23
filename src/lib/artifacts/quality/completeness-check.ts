import type { QualityCheckResult } from "./schema-check";

export function completenessCheck(
  canonical: unknown,
  requiredSectionKeys?: string[],
): QualityCheckResult {
  const errors: string[] = [];
  if (!canonical || typeof canonical !== "object") {
    return { check: "completeness", ok: false, errors: ["canonical content missing"] };
  }
  const obj = canonical as {
    title?: string;
    sections?: Array<{ key: string; blocks?: unknown[] }>;
    slides?: unknown[];
    sheets?: unknown[];
  };
  if (!obj.title?.trim()) errors.push("title is empty");

  if (Array.isArray(obj.sections)) {
    if (obj.sections.length === 0) errors.push("no sections");
    for (const key of requiredSectionKeys ?? []) {
      if (!obj.sections.some((s) => s.key === key)) {
        errors.push(`missing required section: ${key}`);
      }
    }
    for (const section of obj.sections) {
      if (!section.blocks?.length) errors.push(`section ${section.key} has no blocks`);
    }
  } else if (Array.isArray(obj.slides)) {
    if (obj.slides.length === 0) errors.push("no slides");
  } else if (Array.isArray(obj.sheets)) {
    if (obj.sheets.length === 0) errors.push("no sheets");
  } else {
    errors.push("no content sections/slides/sheets");
  }

  return { check: "completeness", ok: errors.length === 0, errors };
}
