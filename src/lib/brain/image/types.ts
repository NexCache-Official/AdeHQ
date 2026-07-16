/** PR-16 — Image creation / editing contracts (member-facing intents, not model SKUs). */

export type ImageIntent = "quick" | "business_graphic" | "premium" | "edit";

export type ImageRouteId =
  | "route_image_z_image_turbo"
  | "route_image_qwen_image"
  | "route_image_qwen_image_edit"
  | "route_image_flux2_flex";

/** Member-safe action labels — never expose model names. */
export const IMAGE_INTENT_LABEL: Record<ImageIntent, string> = {
  quick: "Create image",
  business_graphic: "Create business graphic",
  premium: "Create premium visual",
  edit: "Edit image",
};

export const IMAGE_INTENT_WH: Record<ImageIntent, number> = {
  quick: 0.5,
  business_graphic: 2,
  premium: 6,
  edit: 4,
};

export type ImageSize =
  | "512x512"
  | "768x1024"
  | "1024x576"
  | "576x1024"
  | "1024x1024"
  | "1328x1328";

export type ImageGenerationRequest = {
  intent: ImageIntent;
  prompt: string;
  title?: string;
  negativePrompt?: string;
  imageSize?: ImageSize;
  /** Required for edit / regenerate-from-file. */
  sourceFileId?: string;
  sourceArtifactId?: string;
  sourceExportId?: string;
  /** Parent artifact when regenerating / editing a prior generation. */
  parentArtifactId?: string;
  taskId?: string;
  confirmed?: boolean;
};

export type ImageGenerationResult = {
  intent: ImageIntent;
  routeId: ImageRouteId;
  memberLabel: string;
  estimatedWh: number;
  costUsd: number;
  prompt: string;
  bytes: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  latencyMs: number;
  seed?: number | null;
};

export type ImagePolicyDecision = {
  action: "proceed" | "confirm_low_balance" | "confirm_premium" | "blocked";
  estimatedWh: number;
  memberLabel: string;
  remainingWh: number | null;
  reason?: string;
};
