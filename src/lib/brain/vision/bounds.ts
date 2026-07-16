/** Bounded visual context — keep VL prompts and cost predictable. */

export const VISION_MAX_ASSETS = 4;
export const VISION_MAX_EDGE_PX = 1568;
export const VISION_MAX_BYTES_PER_ASSET = 2_500_000;
export const VISION_JPEG_QUALITY = 82;
/** Soft floor — escalate when VL-8B reports below this. */
export const VISION_ESCALATE_CONFIDENCE_BELOW = 0.62;

export function truncateAssets<T>(assets: T[], max = VISION_MAX_ASSETS): T[] {
  return assets.slice(0, max);
}
