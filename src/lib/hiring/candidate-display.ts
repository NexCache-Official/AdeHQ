import type { AiEmployeeApplicant, CandidateTier } from "./types";

export function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}…`;
}

export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^[^.!?]+[.!?]?/);
  return (match?.[0] ?? trimmed).trim();
}

export function limitBullets<T>(items: T[], max: number): T[] {
  return items.slice(0, max);
}

export function tierBadgeLabel(tier: CandidateTier): string {
  if (tier === "recommended") return "Best overall";
  if (tier === "high_capacity") return "Fastest";
  return "Highest quality";
}

/** One-line card summary — short but informative. */
export function candidateOneLineSummary(applicant: AiEmployeeApplicant): string {
  if (applicant.candidatePitch) {
    const pitch = applicant.candidatePitch
      .replace(/^I'm\s+/i, "")
      .replace(/\.$/, "")
      .trim();
    return truncateWords(firstSentence(pitch), 18);
  }
  const why = applicant.whyThisCandidate
    ?.replace(/^Recommended because\s+/i, "")
    .replace(/^Premium tier for\s+/i, "")
    .replace(/^High capacity for\s+/i, "")
    .trim();
  if (why) return truncateWords(firstSentence(why), 18);
  return truncateWords(applicant.bestFor, 18);
}

/** Short reason for recommendation banner subtitle. */
export function candidateRecommendationReason(applicant: AiEmployeeApplicant): string {
  const raw =
    applicant.whyThisCandidate?.replace(/^Recommended because\s+/i, "").trim() ??
    applicant.bestFor;
  return truncateWords(firstSentence(raw), 12);
}

export function recommendationHeadline(applicant: AiEmployeeApplicant): string {
  const reason = candidateRecommendationReason(applicant).toLowerCase();
  return `${applicant.name} — ${applicant.badge} for ${reason}.`;
}

export function recommendationBestIf(applicant: AiEmployeeApplicant): string {
  const line = truncateWords(applicant.bestFor, 14);
  const normalized = line.charAt(0).toLowerCase() + line.slice(1);
  return `Best if you want ${normalized.replace(/\.$/, "")}.`;
}
