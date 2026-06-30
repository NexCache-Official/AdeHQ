import type { AiEmployeeJobBrief, RecruiterChecklist, RecruiterMessage } from "./types";

export function emptyChecklist(): RecruiterChecklist {
  return {
    roleKnown: false,
    domainKnown: false,
    coreWorkKnown: false,
    workStyleKnown: false,
    communicationKnown: false,
  };
}

export function checklistFromBrief(
  brief: Partial<AiEmployeeJobBrief> | undefined,
  roleSeed: string,
): RecruiterChecklist {
  if (!brief) {
    return {
      roleKnown: Boolean(roleSeed.trim()),
      domainKnown: false,
      coreWorkKnown: false,
      workStyleKnown: false,
      communicationKnown: false,
    };
  }
  return {
    roleKnown: Boolean(brief.roleTitle?.trim() || roleSeed.trim()),
    domainKnown: Boolean(brief.domain?.trim()),
    coreWorkKnown:
      (brief.coreResponsibilities?.length ?? 0) > 0 ||
      (brief.technicalFocus?.length ?? 0) > 0,
    workStyleKnown: Boolean(brief.qualityPreference && brief.proactivityLevel),
    communicationKnown:
      Boolean(brief.communicationStyle?.trim()) ||
      (brief.personalityTraits?.length ?? 0) > 0,
  };
}

export function checklistScore(checklist: RecruiterChecklist): number {
  return Object.values(checklist).filter(Boolean).length;
}

export function isChecklistReady(checklist: RecruiterChecklist): boolean {
  return checklistScore(checklist) >= 4;
}

export function countUserTurns(messages: RecruiterMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

export function hasMeaningfulAnswer(messages: RecruiterMessage[], roleSeed: string): boolean {
  const userTexts = messages.filter((m) => m.role === "user").map((m) => m.text.trim());
  if (userTexts.length === 0) return Boolean(roleSeed.trim().length > 12);
  return userTexts.some((t) => t.length > 3);
}

export function shouldOfferDraftNow(
  messages: RecruiterMessage[],
  roleSeed: string,
  checklist: RecruiterChecklist,
): boolean {
  if (isChecklistReady(checklist)) return true;
  if (hasMeaningfulAnswer(messages, roleSeed) && countUserTurns(messages) >= 1) return true;
  if (roleSeed.trim().split(/\s+/).length >= 6) return true;
  return false;
}

export function shouldAutoBriefReady(
  messages: RecruiterMessage[],
  checklist: RecruiterChecklist,
): boolean {
  const turns = countUserTurns(messages);
  return turns >= 3 || isChecklistReady(checklist);
}

export const DEFAULT_CHIPS = {
  draftNow: "Draft brief now",
  refineMore: "Refine more",
  reviewBrief: "Review job brief →",
};
