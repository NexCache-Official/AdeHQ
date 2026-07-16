import { isBrainVisionV1Enabled } from "@/lib/brain/flags";
import { isVisionEligibleFile } from "./normalize";

const VISION_ASK =
  /\b(look\s+at|what('?s|\s+is)\s+(in|on)\s+(this|the)\s+(image|screenshot|photo|chart|scan|receipt|document)|describe\s+(this|the)\s+(image|screenshot|photo)|read\s+(this|the)\s+(scan|receipt|chart)|ocr|from\s+the\s+(screenshot|image|photo)|see\s+(attached|the\s+image))\b/i;

/**
 * When attached visuals exist, run vision. Also run when the user explicitly asks
 * about an image even if eligibility is borderline (e.g. image-only PDF skipped).
 */
export function shouldRunVision(params: {
  attachmentFileIds: string[];
  hasVisualAssets: boolean;
  userMessage: string;
  killSwitch?: boolean;
}): boolean {
  if (params.killSwitch === false) return false;
  if (!isBrainVisionV1Enabled()) return false;
  if (params.hasVisualAssets) return true;
  if (params.attachmentFileIds.length > 0 && VISION_ASK.test(params.userMessage)) {
    return true;
  }
  return false;
}

export function fileRowLooksVisual(row: {
  mime_type?: string | null;
  extension?: string | null;
  parse_status?: string | null;
}): boolean {
  return isVisionEligibleFile({
    mimeType: row.mime_type,
    extension: row.extension,
    parseStatus: row.parse_status,
  });
}
