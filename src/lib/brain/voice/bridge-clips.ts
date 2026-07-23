import type { LiveTtsRouteId } from "./live-types";

export type CachedBridgeClip = {
  bytes: Buffer;
  mimeType: string;
  routeId: LiveTtsRouteId;
};

const MAX_BRIDGE_CLIPS = 64;
const bridgeClips = new Map<string, CachedBridgeClip>();

export function bridgeClipKey(input: {
  routeId: LiveTtsRouteId;
  voice: string;
  locale: string;
  pace: number;
  text: string;
}): string {
  return [
    input.routeId,
    input.voice,
    input.locale,
    input.pace.toFixed(2),
    input.text.trim().toLowerCase(),
  ].join(":");
}

export function getCachedBridgeClip(key: string): CachedBridgeClip | null {
  const clip = bridgeClips.get(key);
  if (!clip) return null;
  bridgeClips.delete(key);
  bridgeClips.set(key, clip);
  return clip;
}

export function cacheBridgeClip(key: string, clip: CachedBridgeClip): void {
  bridgeClips.delete(key);
  bridgeClips.set(key, clip);
  while (bridgeClips.size > MAX_BRIDGE_CLIPS) {
    const oldest = bridgeClips.keys().next().value as string | undefined;
    if (!oldest) break;
    bridgeClips.delete(oldest);
  }
}
