export type {
  VisionRouteId,
  VisionNeed,
  VisualAssetKind,
  VisualAssetSource,
  NormalizedVisualAsset,
  VisionConfidenceAssessment,
  VisionAttemptRecord,
  VisionAttemptOutcome,
  VisionUnderstandingResult,
} from "./types";
export {
  VISION_MAX_ASSETS,
  VISION_MAX_EDGE_PX,
  VISION_MAX_BYTES_PER_ASSET,
  VISION_ESCALATE_CONFIDENCE_BELOW,
} from "./bounds";
export {
  assessVisionConfidence,
  extractUnderstandingText,
  inferVisionNeed,
  shouldEscalateFromStandard,
  shouldStartOnEscalationRoute,
} from "./confidence";
export {
  isVisualMimeType,
  isVisualExtension,
  isVisionEligibleFile,
  guessVisualKind,
  boundVisualBytes,
  toDataUrl,
  normalizeVisualAsset,
  loadVisualAssetsFromWorkspaceFiles,
  loadVisualAssetsFromEmailAttachments,
} from "./normalize";
export { callSiliconFlowVision } from "./adapter";
export { executeVisionUnderstanding, type ExecuteVisionParams } from "./execute";
export { shouldRunVision, fileRowLooksVisual } from "./select";
export { buildVisionPromptBlock } from "./prompt";
