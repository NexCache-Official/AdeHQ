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

/** Only count checklist items the user actually contributed — not auto-filled defaults. */
export function checklistFromBrief(
  brief: Partial<AiEmployeeJobBrief> | undefined,
  roleSeed: string,
  messages: RecruiterMessage[] = [],
): RecruiterChecklist {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.text.toLowerCase())
    .join(" ");
  const userTurns = countUserTurns(messages);

  if (!brief || userTurns === 0) {
    return {
      roleKnown: Boolean(roleSeed.trim().length > 2),
      domainKnown: false,
      coreWorkKnown: false,
      workStyleKnown: false,
      communicationKnown: false,
    };
  }

  const workStyleMentioned =
    userText.includes("quality") ||
    userText.includes("speed") ||
    userText.includes("proactive") ||
    userText.includes("balanced") ||
    userText.includes("direction");

  return {
    roleKnown: Boolean(brief.roleTitle?.trim() || roleSeed.trim()),
    domainKnown: userTurns >= 1 && Boolean(brief.domain?.trim()),
    coreWorkKnown:
      userTurns >= 1 &&
      ((brief.coreResponsibilities?.length ?? 0) > 0 ||
        (brief.technicalFocus?.length ?? 0) > 0),
    workStyleKnown: userTurns >= 1 && workStyleMentioned,
    communicationKnown:
      userTurns >= 1 &&
      (Boolean(brief.communicationStyle?.trim()) ||
        (brief.personalityTraits?.length ?? 0) > 0),
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

/** Optional skip chip — never auto-advances; user must click it explicitly. */
export function shouldOfferDraftNow(
  messages: RecruiterMessage[],
  roleSeed: string,
): boolean {
  if (countUserTurns(messages) >= 1) return true;
  if (roleSeed.trim().split(/\s+/).length >= 6) return true;
  return hasMeaningfulAnswer(messages, roleSeed);
}

/** Ade suggests review after enough conversation — still requires explicit click. */
export function shouldAutoBriefReady(messages: RecruiterMessage[]): boolean {
  return countUserTurns(messages) >= 3;
}

export const DEFAULT_CHIPS = {
  draftNow: "Draft brief now",
  refineMore: "Refine more",
  reviewBrief: "Review job brief →",
};
