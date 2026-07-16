/** PR-15 — Brain vision contracts. */

export type VisionRouteId =
  | "route_vision_qwen3_vl_8b_sf"
  | "route_vision_qwen3_vl_32b_sf";

export type VisionNeed = "standard" | "complex";

export type VisualAssetKind =
  | "screenshot"
  | "chart"
  | "document_page"
  | "property_product"
  | "ui_bug"
  | "low_quality_scan"
  | "other";

export type VisualAssetSource =
  | "workspace_file"
  | "drive_evidence"
  | "inbox_attachment"
  | "inline";

export type NormalizedVisualAsset = {
  id: string;
  source: VisualAssetSource;
  kind: VisualAssetKind;
  fileName: string;
  mimeType: string;
  /** Bytes after bound/normalize (may be resized). */
  bytes: Buffer;
  width?: number;
  height?: number;
  byteLength: number;
  /** Provenance for citations / WH receipts. */
  provenance: {
    fileId?: string;
    storageBucket?: string;
    storagePath?: string;
    emailAttachmentId?: string;
    evidenceId?: string;
    pageIndex?: number;
  };
};

export type VisionConfidenceAssessment = {
  confidence: number;
  needsEscalation: boolean;
  reasons: string[];
  uncertainDetails: string[];
};

export type VisionAttemptOutcome =
  | "succeeded"
  | "escalated"
  | "failed"
  | "skipped_kill_switch"
  | "skipped_no_assets";

export type VisionAttemptRecord = {
  routeId: VisionRouteId;
  need: VisionNeed;
  outcome: VisionAttemptOutcome;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  confidence?: number;
  error?: string;
};

export type VisionUnderstandingResult = {
  text: string;
  routeId: VisionRouteId;
  need: VisionNeed;
  confidence: number;
  escalated: boolean;
  attempts: VisionAttemptRecord[];
  assets: Array<{
    id: string;
    fileName: string;
    source: VisualAssetSource;
    provenance: NormalizedVisualAsset["provenance"];
  }>;
  /** Prompt block injected into employee file/visual context. */
  promptBlock: string;
};
