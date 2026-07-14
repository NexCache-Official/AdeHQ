/**
 * Shared detection for Drive file deliverables (PDF/DOCX/PPTX/XLSX).
 * Used by model-mode routing and steward so artifact asks don't land on
 * MiniMax long_context or get diverted into pure search.
 */

export function isDriveArtifactAsk(message: string): boolean {
  const text = message.trim();
  if (!text) return false;

  if (
    /\b(?:createPdfReport|createDocx|createPresentation|createSpreadsheet|artifact\.create)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  const hasFileKind =
    /\b(?:pdf|docx|pptx|xlsx|spreadsheet|workbook|excel|powerpoint|word(?:\s+doc(?:ument)?)?|deck|slides?|presentation|scorecard|tracker)\b/i.test(
      text,
    );
  const hasCreateVerb =
    /\b(?:create|draft|build|make|generate|prepare|compile|produce|export)\b/i.test(text);
  const hasDrive =
    /\b(?:drive|save(?:\s+it)?\s+to|open from)\b/i.test(text);

  if (hasFileKind && (hasCreateVerb || hasDrive)) return true;

  // "1–2 page … briefing … Save to Drive"
  if (
    hasDrive &&
    /\b(?:brief|briefing|report|memo|proposal|sow|rfp|scorecard|tracker|kpi)\b/i.test(text)
  ) {
    return true;
  }

  return false;
}

/** Harder artifact asks warrant strong structured models (not max context). */
export function artifactAskNeedsStrongModel(message: string): boolean {
  const text = message.trim();
  if (text.length > 180) return true;
  return /\b(?:vendor|competitor|compar|research|market|rfp|sow|board|exec|recommendation|comprehensive|3 vendors|ops briefing|field-service)\b/i.test(
    text,
  );
}
