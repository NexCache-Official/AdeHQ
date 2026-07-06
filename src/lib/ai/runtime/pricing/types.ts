import type { AiCapability } from "../types";
import type { ProviderRoute } from "../types";

export type PriceSource =
  | "vercel_api"
  | "siliconflow_api"
  | "manual_override"
  | "manual_seed";

export type ModelType = "language" | "embedding" | "reranker";

export type PriceProvenance = {
  sourceUrl?: string;
  verifiedAt: string;
  verifiedBy: "manual_page_check";
  priceSource?: "vercel_page_manual" | "siliconflow_page_manual";
  notes: string;
};

export type EmbeddingProfile = "pinned_bge" | "allow_gateway";

export type ModelEndpointOffer = {
  id?: string;
  providerRoute: ProviderRoute;
  providerName: string;
  modelId: string;
  gatewayProviderSlug?: string;
  endpointKey?: string;
  providerDisplayName?: string;
  normalizedModelFamily: string;
  displayName: string;
  modelType: ModelType;
  capabilities: AiCapability[];
  runtimeModes: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  cachedInputCostPerMillion?: number;
  pricingUnit?: string;
  throughputTps?: number;
  latencySeconds?: number;
  pricingDiscountActive?: boolean;
  originalInputCostPerMillion?: number;
  originalOutputCostPerMillion?: number;
  pricingNotes?: string;
  currency: string;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  qualityScore?: number;
  reliabilityScore?: number;
  supportsJson: boolean;
  supportsTools: boolean;
  supportsEmbeddings: boolean;
  supportsLongContext: boolean;
  supportsJsonVerifiedAt?: string | null;
  supportsToolsVerifiedAt?: string | null;
  supportsEmbeddingsVerifiedAt?: string | null;
  enabled: boolean;
  source: PriceSource;
  priceFetchedAt?: string | null;
  metadata?: Record<string, unknown> & Partial<PriceProvenance>;
};

export type PriceSnapshotInput = {
  providerRoute: string;
  modelId: string;
  gatewayProviderSlug?: string;
  endpointKey?: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cachedInputCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  source: string;
  rawPayload?: Record<string, unknown>;
};

export type ProviderSyncResult = {
  provider: "vercel" | "siliconflow";
  status: "success" | "skipped" | "failed";
  offersAdded: number;
  offersUpdated: number;
  offersDisabled: number;
  error?: string;
  offers: ModelEndpointOffer[];
  snapshots: PriceSnapshotInput[];
};

export type SyncOptions = {
  providers?: Array<"vercel" | "siliconflow">;
  dryRun?: boolean;
};

export type SyncRunSummary = {
  dryRun: boolean;
  results: ProviderSyncResult[];
  totalAdded: number;
  totalUpdated: number;
  totalDisabled: number;
};
