/** High-level category of a billable AI cost event. */
export type CostSourceType =
  | "llm"
  | "search"
  | "browser"
  | "embedding"
  | "file_analysis"
  | "artifact"
  | "system"
  | "manual_adjustment";

/** How the cost figure was derived. */
export type CostSource =
  | "provider_usage"
  | "provider_invoice"
  | "token_rates"
  | "estimated"
  | "manual";

/** Normalized token usage parsed from a provider response. */
export type ParsedProviderUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costSource: Extract<CostSource, "provider_usage" | "estimated">;
};

/** Input to record a single cost ledger event. */
export type CostEventInput = {
  workspaceId: string;
  userId?: string | null;
  employeeId?: string | null;
  workUnitId?: string | null;
  roomId?: string | null;
  topicId?: string | null;
  messageId?: string | null;

  sourceType: CostSourceType;

  providerRoute?: string | null;
  providerName?: string | null;
  modelId?: string | null;
  endpointKey?: string | null;
  providerCredentialId?: string | null;
  providerAllocationId?: string | null;
  providerProjectId?: string | null;

  runtimeMode?: string | null;
  capability?: string | null;
  workType?: string | null;

  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;

  searchRequests?: number;
  searchCredits?: number;
  browserSessionSeconds?: number;
  browserPagesOpened?: number;
  browserScreenshots?: number;

  imageCount?: number;
  videoCount?: number;
  ttsUtf8Bytes?: number;

  unitCostUsd?: number | null;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  costSource?: CostSource;

  billableToWorkspace?: boolean;
  platformOverhead?: boolean;

  status?: "succeeded" | "failed" | "cancelled";
  errorCode?: string | null;
  errorMessage?: string | null;

  pricingSnapshotId?: string | null;
  idempotencyKey?: string | null;
  brainRunId?: string | null;
  decisionAttemptId?: string | null;
  packetVersion?: string | null;
  decisionVersion?: string | null;
  routerVersion?: string | null;
  catalogVersion?: string | null;

  metadata?: Record<string, unknown>;
};

export type CostLedgerEntry = {
  id: string;
  workspaceId: string;
  employeeId: string | null;
  sourceType: CostSourceType;
  actualCostUsd: number;
  providerCredentialId?: string | null;
  providerAllocationId?: string | null;
  providerProjectId?: string | null;
  workHoursCharged: number;
  billableToWorkspace: boolean;
  platformOverhead: boolean;
  createdAt: string;
};
