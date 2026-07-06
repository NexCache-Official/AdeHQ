import { generateUniqueCandidateNames } from "./candidate-names";
import type { CandidateTier } from "./types";

export type MayaHiringProposal = {
  userText: string;
  roleTitle: string;
  roleKey: string;
};

export function mayaHiringProposalMessage(roleTitle: string): string {
  return `Sounds like you want to hire a ${roleTitle}. Choose how you'd like to organize this hiring session below.`;
}

export function mayaHiringTopicSuggestionTitle(): string {
  return "Create hiring topic?";
}

export function mayaHiringTopicSuggestionBody(roleTitle: string): string {
  return `I can create a focused topic for hiring a ${roleTitle} so the job brief, candidates, and final hire stay organized.`;
}

export function mayaHiringTopicCancelledReply(firstName = "there"): string {
  return `No problem, ${firstName} — what else can I help with? Ask about AdeHQ, your workforce, or tell me when you're ready to hire.`;
}

export function mayaHiringTopicReadyMessage(roleTitle: string, topicTitle: string): string {
  return `Hiring topic ready — ${topicTitle}. Let's define what you need in this ${roleTitle} role.`;
}

export function candidateScopeId(
  sessionScope: string,
  tier: CandidateTier,
): string {
  return `${sessionScope}:${tier}`;
}

export function stampCandidatesForSession<T extends { id: string; tier: CandidateTier; name: string }>(
  candidates: T[],
  sessionScope: string,
  roleKey: string | null | undefined,
  roleTitle: string | null | undefined,
  hiringSessionId?: string | null,
): (T & { roleKey?: string; roleTitle?: string; hiringSessionId?: string; generatedAt: string })[] {
  const generatedAt = new Date().toISOString();
  const nameSeed = `${sessionScope}:${roleTitle ?? "role"}:${roleKey ?? "custom"}:${generatedAt}`;
  const uniqueNames = generateUniqueCandidateNames(nameSeed, candidates.length);
  const usedNames = new Set<string>();

  return candidates.map((c, index) => {
    let name = c.name;
    if (usedNames.has(name) || candidates.filter((x) => x.name === name).length > 1) {
      name = uniqueNames[index] ?? name;
    }
    usedNames.add(name);
    return {
      ...c,
      name,
      first: name.split(" ")[0] ?? name,
      id: candidateScopeId(sessionScope, c.tier),
      roleKey: roleKey ?? undefined,
      roleTitle: roleTitle ?? undefined,
      hiringSessionId: hiringSessionId ?? undefined,
      generatedAt,
    };
  });
}
