import type { QualityCheckResult } from "./schema-check";

function extractText(canonical: unknown): string {
  if (!canonical || typeof canonical !== "object") return "";
  const obj = canonical as {
    title?: string;
    summary?: string;
    sections?: Array<{ title?: string; blocks?: Array<{ text?: string; items?: string[] }> }>;
    slides?: Array<{ title?: string; bullets?: string[] }>;
  };
  const parts: string[] = [];
  if (obj.title) parts.push(obj.title);
  if (obj.summary) parts.push(obj.summary);
  for (const section of obj.sections ?? []) {
    if (section.title) parts.push(section.title);
    for (const block of section.blocks ?? []) {
      if (block.text) parts.push(block.text);
      if (block.items) parts.push(...block.items);
    }
  }
  for (const slide of obj.slides ?? []) {
    if (slide.title) parts.push(slide.title);
    if (slide.bullets) parts.push(...slide.bullets);
  }
  return parts.join("\n");
}

export function readabilityCheck(canonical: unknown): QualityCheckResult {
  const errors: string[] = [];
  const text = extractText(canonical).trim();
  if (text.length < 40) errors.push("content too short for delivery");
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 12) errors.push("too few words");
  const avgWordLen =
    words.length === 0 ? 0 : words.reduce((n, w) => n + w.length, 0) / words.length;
  if (avgWordLen > 14) errors.push("average word length unusually high");
  return { check: "readability", ok: errors.length === 0, errors };
}
