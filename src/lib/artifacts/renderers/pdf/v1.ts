import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildHtmlPreviewFromCanonical } from "../html/preview";
import type { ArtifactRenderer, ArtifactRendererInput, ArtifactRendererResult } from "../types";

/**
 * V1 PDF renderer — lightweight pdf-lib text PDF from canonical content.
 * Full Playwright HTML→PDF path is worker-side (`pdf.playwright.v1` job).
 */
export async function renderPdfV1(input: ArtifactRendererInput): Promise<ArtifactRendererResult> {
  const html = buildHtmlPreviewFromCanonical(input.canonical);
  // Strip tags for a simple text PDF placeholder (worker Playwright does visual PDF).
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, 12_000);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage();
  const margin = 48;
  let y = page.getHeight() - margin;
  const size = 11;
  const lines = text.split("\n");

  for (const line of lines) {
    if (y < margin) {
      page = doc.addPage();
      y = page.getHeight() - margin;
    }
    page.drawText(line.slice(0, 100), {
      x: margin,
      y,
      size,
      font,
      color: rgb(0.07, 0.09, 0.15),
    });
    y -= size + 4;
  }

  const bytes = await doc.save();
  return {
    format: "pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
    pageOrSlideCount: doc.getPageCount(),
  };
}

export const pdfRendererV1: ArtifactRenderer = {
  key: "pdf.playwright.v1",
  version: "1",
  format: "pdf",
  mimeType: "application/pdf",
  // Request path uses pdf-lib placeholder; Playwright remains the worker implementation.
  render: renderPdfV1,
};
