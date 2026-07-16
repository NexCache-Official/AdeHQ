import type { VideoIntent, VideoRouteId } from "./types";
import { VIDEO_ESTIMATED_WH, VIDEO_INTENT_LABEL } from "./types";

export function routeIdForVideoIntent(intent: VideoIntent): VideoRouteId {
  return intent === "image_to_video"
    ? "route_video_wan22_i2v"
    : "route_video_wan22_t2v";
}

export function memberLabelForVideoIntent(intent: VideoIntent): string {
  return VIDEO_INTENT_LABEL[intent];
}

export function estimatedWhForVideo(): number {
  return VIDEO_ESTIMATED_WH;
}

export function inferVideoIntent(message: string, hasSourceImage: boolean): VideoIntent | null {
  const text = message.toLowerCase();
  if (!/\b(video|clip|mp4|animate|motion)\b/.test(text)) return null;
  if (
    hasSourceImage ||
    /\b(from\s+(this\s+)?(image|photo|picture|screenshot)|image[- ]to[- ]video|animate\s+(this|the)\s+image)\b/.test(
      text,
    )
  ) {
    return "image_to_video";
  }
  if (/\b(text[- ]to[- ]video|from\s+text|generate\s+a\s+video|create\s+a\s+video|make\s+a\s+video)\b/.test(text)) {
    return "text_to_video";
  }
  return hasSourceImage ? "image_to_video" : "text_to_video";
}
