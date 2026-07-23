import type { ArtifactRenderer } from "./types";
import { pptxRendererV1 } from "./pptx/v1";
import { docxRendererV1 } from "./docx/v1";
import { xlsxRendererV1 } from "./xlsx/v1";
import { htmlPreviewRenderer } from "./html/preview";
import { pdfRendererV1 } from "./pdf/v1";

/** Static artifact renderers keyed by renderer key. */
export const ARTIFACT_RENDERERS: Record<string, ArtifactRenderer> = {
  "pptx.pptxgenjs.v1": pptxRendererV1,
  "docx.docxjs.v1": docxRendererV1,
  "xlsx.exceljs.v1": xlsxRendererV1,
  "pdf.playwright.v1": pdfRendererV1,
  "html.preview.v1": htmlPreviewRenderer,
};

export function getArtifactRenderer(key: string): ArtifactRenderer | undefined {
  return ARTIFACT_RENDERERS[key];
}
