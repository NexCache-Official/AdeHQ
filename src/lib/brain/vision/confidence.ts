import { VISION_ESCALATE_CONFIDENCE_BELOW } from "./bounds";
import type { VisionConfidenceAssessment, VisionNeed } from "./types";

const COMPLEX_HINT =
  /\b(compare|root cause|why|debug|reconstruct|ocr\s+all|extract\s+every|table\s+of|reconcile|cross[- ]check|legal\s+risk|ui\s+bug|regression|diff)\b/i;

const LOW_QUALITY_HINT =
  /\b(blurry|illegible|low[- ]quality|scanned|fax|noisy|hard\s+to\s+read)\b/i;

export function inferVisionNeed(params: {
  userMessage: string;
  intensity?: "fast" | "standard" | "deep" | "research";
  assetCount: number;
  hasLowQualityHint?: boolean;
}): VisionNeed {
  if (params.intensity === "deep" || params.intensity === "research") return "complex";
  if (params.assetCount > 2) return "complex";
  if (COMPLEX_HINT.test(params.userMessage)) return "complex";
  if (params.hasLowQualityHint || LOW_QUALITY_HINT.test(params.userMessage)) return "complex";
  return "standard";
}

export function shouldStartOnEscalationRoute(need: VisionNeed): boolean {
  return need === "complex";
}

/**
 * Parse model JSON confidence, or fall back to heuristics from free text.
 */
export function assessVisionConfidence(params: {
  rawText: string;
  userMessage: string;
  need: VisionNeed;
}): VisionConfidenceAssessment {
  const parsed = tryParseVisionJson(params.rawText);
  const reasons: string[] = [];
  let confidence =
    typeof parsed?.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.72;
  let needsEscalation = Boolean(parsed?.needsEscalation);
  const uncertainDetails = Array.isArray(parsed?.uncertainDetails)
    ? parsed!.uncertainDetails.map(String).slice(0, 12)
    : [];

  if (parsed?.confidence == null) {
    reasons.push("missing_structured_confidence");
    confidence = 0.55;
  }
  if (uncertainDetails.length >= 3) {
    needsEscalation = true;
    reasons.push("many_uncertain_details");
  }
  if (confidence < VISION_ESCALATE_CONFIDENCE_BELOW) {
    needsEscalation = true;
    reasons.push("low_confidence");
  }
  if (params.need === "complex" && confidence < 0.85) {
    needsEscalation = true;
    reasons.push("complex_need");
  }
  if (/\b(cannot\s+read|unable\s+to\s+see|illegible|too\s+blurry)\b/i.test(params.rawText)) {
    needsEscalation = true;
    reasons.push("readability_failure");
    confidence = Math.min(confidence, 0.4);
  }
  if (COMPLEX_HINT.test(params.userMessage) && confidence < 0.8) {
    needsEscalation = true;
    reasons.push("complex_user_ask");
  }

  return { confidence, needsEscalation, reasons, uncertainDetails };
}

export function shouldEscalateFromStandard(assessment: VisionConfidenceAssessment): boolean {
  return assessment.needsEscalation;
}

type VisionJson = {
  understanding?: string;
  confidence?: number;
  uncertainDetails?: unknown[];
  needsEscalation?: boolean;
};

function tryParseVisionJson(raw: string): VisionJson | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as VisionJson;
  } catch {
    return null;
  }
}

export function extractUnderstandingText(raw: string): string {
  const parsed = tryParseVisionJson(raw);
  if (parsed?.understanding?.trim()) return parsed.understanding.trim();
  // Strip trailing JSON object if the model mixed prose + JSON.
  const withoutJson = raw.replace(/\{[\s\S]*"confidence"[\s\S]*\}/m, "").trim();
  return withoutJson || raw.trim();
}
