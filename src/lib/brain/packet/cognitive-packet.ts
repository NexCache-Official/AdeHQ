import { createHash } from "crypto";
import type { IntelligenceContext } from "@/lib/ai/intelligence/intelligence-context";
import {
  PACKET_VERSION,
  type BrainIntensity,
} from "@/lib/brain/catalog";
import type { OutputContract } from "@/lib/brain/contracts";

export type CapabilityPlanStep = {
  id: string;
  capability: string;
  outputContract: OutputContract;
  dependencies?: string[];
};

export type CognitivePacketRuntime = {
  packetVersion: string;
  intensity: BrainIntensity;
  capabilityPlan: CapabilityPlanStep[];
  artifactRefs: string[];
  /** Runtime-only compiled context — never persisted as full text. */
  intelligence: IntelligenceContext;
};

export type CognitivePacketAuditRecord = {
  id: string;
  brainRunId: string;
  workspaceId: string;
  pricingSnapshotId?: string | null;
  sourceIds: string[];
  contentHashes: string[];
  excerptRefs: string[];
  decisionMetadata: Record<string, unknown>;
};

export function mapWorkModeToIntensity(
  workMode?: string | null,
): BrainIntensity {
  switch (workMode) {
    case "fast":
      return "fast";
    case "deep":
      return "deep";
    case "research":
      return "research";
    case "standard":
    case "balanced":
    case "collaboration":
    default:
      return "standard";
  }
}

export function fromIntelligenceContext(
  intelligence: IntelligenceContext,
  options?: {
    intensity?: BrainIntensity;
    capabilityPlan?: CapabilityPlanStep[];
    artifactRefs?: string[];
  },
): CognitivePacketRuntime {
  return {
    packetVersion: PACKET_VERSION,
    intensity: options?.intensity ?? mapWorkModeToIntensity(intelligence.workMode),
    capabilityPlan: options?.capabilityPlan ?? [
      {
        id: "step_text_1",
        capability: "reasoning",
        outputContract: { type: "text" },
      },
    ],
    artifactRefs: options?.artifactRefs ?? [],
    intelligence,
  };
}

/** Hash content for audit — never store the raw string. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildPacketAuditRecord(input: {
  brainRunId: string;
  workspaceId: string;
  sourceIds?: string[];
  contentsToHash?: string[];
  excerptRefs?: string[];
  pricingSnapshotId?: string | null;
  decisionMetadata?: Record<string, unknown>;
}): CognitivePacketAuditRecord {
  return {
    id: `bpa_${input.brainRunId}`,
    brainRunId: input.brainRunId,
    workspaceId: input.workspaceId,
    pricingSnapshotId: input.pricingSnapshotId ?? null,
    sourceIds: input.sourceIds ?? [],
    contentHashes: (input.contentsToHash ?? []).map(hashContent),
    excerptRefs: input.excerptRefs ?? [],
    decisionMetadata: input.decisionMetadata ?? {},
  };
}
