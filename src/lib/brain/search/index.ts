export type {
  BrainSearchNeed,
  SearchCapabilityRequest,
  SearchEvidenceAssessment,
  SearchAttemptRecord,
  SearchAttemptOutcome,
  SearchFreshness,
  SearchDepth,
  NormalizedSearchSource,
} from "./types";
export {
  brainNeedToLegacySearchNeed,
  legacySearchNeedToBrainNeed,
  searchRouteToBrainRouteId,
  searchRouteToAttemptProvider,
} from "./types";
export { assessSearchEvidence, shouldFallbackFromEvidence } from "./evidence";
export {
  mapNeedToSearchRouteChain,
  slotToSearchRoute,
  searchRouteToSlot,
  brainRouteIdForSlot,
  isSlotConfigured,
  type SearchProviderSlot,
} from "./route-chain";
