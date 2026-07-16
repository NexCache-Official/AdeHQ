import type { NormalizedVisualAsset, VisionUnderstandingResult } from "./types";

export function buildVisionPromptBlock(result: {
  text: string;
  routeId: string;
  confidence: number;
  escalated: boolean;
  assets: NormalizedVisualAsset[];
}): string {
  const sources = result.assets.map((asset, index) => {
    const refs = [
      asset.provenance.fileId ? `file:${asset.provenance.fileId}` : null,
      asset.provenance.emailAttachmentId
        ? `inbox:${asset.provenance.emailAttachmentId}`
        : null,
      asset.provenance.evidenceId ? `evidence:${asset.provenance.evidenceId}` : null,
    ].filter(Boolean);
    return `- Image ${index + 1}: ${asset.fileName} (${asset.kind}) [${refs.join(", ") || asset.source}]`;
  });

  return [
    "VISUAL CONTEXT (from AdeHQ Brain vision — treat as primary evidence for attached images):",
    `- Route: ${result.routeId}${result.escalated ? " (escalated)" : ""}`,
    `- Confidence: ${result.confidence.toFixed(2)}`,
    "- Cite attached visuals by file name / Image N. Do not invent unseen details.",
    "- Prefer these observations over guessing from filenames alone.",
    "",
    "Sources:",
    ...sources,
    "",
    "Understanding:",
    result.text.trim(),
  ].join("\n");
}

export function visionResultAssetSummary(
  result: VisionUnderstandingResult,
): VisionUnderstandingResult["assets"] {
  return result.assets;
}
