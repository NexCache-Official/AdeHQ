import { buildHtmlPreviewFromCanonical } from "../renderers/html/preview";

export function previewArtifactHtml(canonical: unknown): string {
  return buildHtmlPreviewFromCanonical(canonical);
}

export function previewArtifactMarkdown(canonical: unknown): string {
  if (!canonical || typeof canonical !== "object") return "";
  const obj = canonical as {
    title?: string;
    summary?: string;
    sections?: Array<{ title?: string; blocks?: Array<{ type?: string; text?: string; items?: string[] }> }>;
    slides?: Array<{ title?: string; bullets?: string[] }>;
  };
  const lines: string[] = [];
  if (obj.title) lines.push(`# ${obj.title}`, "");
  if (obj.summary) lines.push(obj.summary, "");
  for (const section of obj.sections ?? []) {
    lines.push(`## ${section.title ?? ""}`, "");
    for (const block of section.blocks ?? []) {
      if (block.text) lines.push(block.text, "");
      if (block.items) {
        for (const item of block.items) lines.push(`- ${item}`);
        lines.push("");
      }
    }
  }
  for (const slide of obj.slides ?? []) {
    lines.push(`## ${slide.title ?? ""}`, "");
    for (const b of slide.bullets ?? []) lines.push(`- ${b}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
