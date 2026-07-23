import type { DocumentArtifactV1 } from "../../contracts/document";
import type { PresentationArtifactV1 } from "../../contracts/presentation";
import type { WorkbookArtifactV1 } from "../../contracts/workbook";
import type { ArtifactRenderer, ArtifactRendererInput, ArtifactRendererResult } from "../types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildHtmlPreviewFromCanonical(canonical: unknown): string {
  if (!canonical || typeof canonical !== "object") {
    return "<html><body><p>Empty artifact</p></body></html>";
  }
  const obj = canonical as Record<string, unknown>;
  const schemaKey = String(obj.schemaKey ?? "");

  if (schemaKey === "adehq.presentation.v1") {
    const p = canonical as PresentationArtifactV1;
    const slides = (p.slides ?? [])
      .map(
        (s) =>
          `<section><h2>${escapeHtml(s.title)}</h2><ul>${(s.bullets ?? [])
            .map((b) => `<li>${escapeHtml(b)}</li>`)
            .join("")}</ul></section>`,
      )
      .join("");
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(p.title)}</title></head><body><h1>${escapeHtml(p.title)}</h1>${slides}</body></html>`;
  }

  if (schemaKey === "adehq.workbook.v1") {
    const w = canonical as WorkbookArtifactV1;
    const sheet = w.sheets?.[0];
    const header = (sheet?.columns ?? []).map((c) => `<th>${escapeHtml(c)}</th>`).join("");
    const rows = (sheet?.rows ?? [])
      .slice(0, 50)
      .map(
        (row) =>
          `<tr>${row.map((c) => `<td>${escapeHtml(String(typeof c === "object" && c && "formula" in c ? (c as { formula: string }).formula : c ?? ""))}</td>`).join("")}</tr>`,
      )
      .join("");
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(w.title)}</title></head><body><h1>${escapeHtml(w.title)}</h1><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }

  const d = canonical as DocumentArtifactV1;
  const sections = (d.sections ?? [])
    .map((section) => {
      const body = (section.blocks ?? [])
        .map((block) => {
          if (block.type === "bullets" || block.type === "numbered") {
            return `<ul>${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
          }
          if (block.type === "heading") {
            return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
          }
          if (block.type === "divider") return "<hr />";
          if ("text" in block) return `<p>${escapeHtml(block.text)}</p>`;
          return "";
        })
        .join("");
      return `<section><h2>${escapeHtml(section.title)}</h2>${body}</section>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(d.title ?? "Artifact")}</title></head><body><h1>${escapeHtml(d.title ?? "Artifact")}</h1>${d.summary ? `<p><em>${escapeHtml(d.summary)}</em></p>` : ""}${sections}</body></html>`;
}

export async function renderHtmlPreview(
  input: ArtifactRendererInput,
): Promise<ArtifactRendererResult> {
  const html = buildHtmlPreviewFromCanonical(input.canonical);
  return {
    format: "html",
    mimeType: "text/html; charset=utf-8",
    buffer: Buffer.from(html, "utf8"),
  };
}

export const htmlPreviewRenderer: ArtifactRenderer = {
  key: "html.preview.v1",
  version: "1",
  format: "html",
  mimeType: "text/html; charset=utf-8",
  render: renderHtmlPreview,
};
