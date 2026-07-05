import type { AiEmployeeJobBrief } from "./types";

export type BriefComposeSection =
  | "title"
  | "mission"
  | "coreResponsibilities"
  | "technicalFocus"
  | "businessFocus"
  | "successMetrics"
  | "assumptions"
  | "openQuestions"
  | "meta";

function arrChanged(a?: string[], b?: string[]) {
  return JSON.stringify(a ?? []) !== JSON.stringify(b ?? []);
}

export function detectBriefChange(
  prev: Partial<AiEmployeeJobBrief> | undefined,
  next: Partial<AiEmployeeJobBrief> | undefined,
): BriefComposeSection | null {
  if (!next) return null;
  if (!prev?.roleTitle?.trim()) return "title";

  if (prev.roleTitle !== next.roleTitle || prev.domain !== next.domain || prev.department !== next.department) {
    return "title";
  }
  if (!prev.mission?.trim() && next.mission?.trim()) return "mission";
  if (arrChanged(prev.coreResponsibilities, next.coreResponsibilities)) return "coreResponsibilities";
  if (arrChanged(prev.technicalFocus, next.technicalFocus)) return "technicalFocus";
  if (arrChanged(prev.businessFocus, next.businessFocus)) return "businessFocus";
  if (arrChanged(prev.successMetrics, next.successMetrics)) return "successMetrics";
  if (arrChanged(prev.assumptions, next.assumptions)) return "assumptions";
  if (arrChanged(prev.openQuestions, next.openQuestions)) return "openQuestions";
  if (
    prev.seniorityLevel !== next.seniorityLevel ||
    prev.autonomyLevel !== next.autonomyLevel ||
    prev.communicationStyle !== next.communicationStyle ||
    prev.proactivityLevel !== next.proactivityLevel ||
    prev.qualityPreference !== next.qualityPreference
  ) {
    return "meta";
  }
  return null;
}
