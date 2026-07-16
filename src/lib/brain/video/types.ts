/** PR-17 — Video generation contracts (member-facing intents, not model SKUs). */

export type VideoIntent = "text_to_video" | "image_to_video";

export type VideoRouteId = "route_video_wan22_t2v" | "route_video_wan22_i2v";

export type VideoArtifactStatus = "processing" | "ready" | "failed" | "cancelled";

/** Exact member estimate copy (non-negotiable product string). */
export const VIDEO_ESTIMATE_CARD_SUMMARY =
  "Create one five-second video. Estimated usage: 29 Work Hours.";

export const VIDEO_ESTIMATED_WH = 29;

export const VIDEO_INTENT_LABEL: Record<VideoIntent, string> = {
  text_to_video: "Create video from text",
  image_to_video: "Create video from image",
};

export type VideoSize = "1280x720" | "720x1280" | "960x960";

export type VideoGenerationRequest = {
  intent: VideoIntent;
  prompt: string;
  title?: string;
  negativePrompt?: string;
  imageSize?: VideoSize;
  sourceFileId?: string;
  sourceArtifactId?: string;
  sourceExportId?: string;
  taskId?: string;
};

export type VideoGenerationResult = {
  intent: VideoIntent;
  routeId: VideoRouteId;
  memberLabel: string;
  estimatedWh: number;
  costUsd: number;
  prompt: string;
  bytes: Buffer;
  mimeType: string;
  latencyMs: number;
  providerRequestId: string;
  seed?: number | null;
  sourceFileId?: string | null;
  sourceArtifactId?: string | null;
};

export type VideoPolicyDecision = {
  action: "proceed" | "blocked_insufficient_wh" | "blocked_exhausted" | "blocked_disabled";
  estimatedWh: number;
  memberLabel: string;
  remainingWh: number | null;
  reason?: string;
  estimateCard: string;
};
