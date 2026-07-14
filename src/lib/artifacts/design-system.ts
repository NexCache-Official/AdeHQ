/** Shared visual tokens for AdeHQ Drive deliverables (PDF/DOCX/XLSX/PPTX). */

export const ARTIFACT_BRAND = {
  ink: "111827",
  inkRgb: { r: 0.07, g: 0.09, b: 0.15 },
  muted: "6B7280",
  mutedRgb: { r: 0.42, g: 0.45, b: 0.5 },
  accent: "0F766E",
  accentRgb: { r: 0.06, g: 0.46, b: 0.43 },
  pale: "F0FDFA",
  paleRgb: { r: 0.94, g: 0.99, b: 0.98 },
  border: "E5E7EB",
  white: "FFFFFF",
  headerFill: "111827",
} as const;

export const ARTIFACT_TYPE = {
  display: "Aptos Display",
  body: "Aptos",
  pdfBody: "Helvetica",
  pdfBold: "Helvetica-Bold",
} as const;
