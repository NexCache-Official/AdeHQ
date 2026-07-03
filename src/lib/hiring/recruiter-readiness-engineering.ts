import type { AiEmployeeJobBrief, RecruiterMessage } from "./types";
import { isHiringSmallTalk } from "./maya-recruiter-state";

const ENGINEERING_DISCIPLINE_PATTERNS = [
  /\bfrontend\b/i,
  /\bbackend\b/i,
  /\bfull[- ]?stack\b/i,
  /\binfra(?:structure)?\b/i,
  /\bdevops\b/i,
  /\bqa\b/i,
  /\bquality assurance\b/i,
  /\btest(?:ing)? engineer\b/i,
  /\bdata engineer(?:ing)?\b/i,
  /\bai infra(?:structure)?\b/i,
  /\bmobile\b/i,
  /\bplatform engineer\b/i,
];

const PRODUCT_CONTEXT_PATTERNS = [
  /\bnext\.?js\b/i,
  /\bsupabase\b/i,
  /\bapi(s)?\b/i,
  /\bmobile\b/i,
  /\binternal tools?\b/i,
  /\bsaas\b/i,
  /\bfintech\b/i,
  /\bgeneral software\b/i,
  /\bour product\b/i,
  /\bproduct area\b/i,
];

const SENIORITY_PATTERNS = [
  /\bsenior\b/i,
  /\bjunior\b/i,
  /\barchitect\b/i,
  /\bmid[- ]?level\b/i,
  /\bimplementer\b/i,
  /\bfast implementer\b/i,
  /\breliable\b/i,
  /\bbuilder\b/i,
  /\bexecutor\b/i,
  /\badvisor\b/i,
  /\bhands[- ]?on\b/i,
];

const SKIP_PATTERNS = /\b(skip|not sure|don't know|no preference|lightweight|keep it simple|help me decide)\b/i;

export function meaningfulUserTurns(conversation: RecruiterMessage[]): number {
  return conversation.filter(
    (m) => m.role === "user" && !isHiringSmallTalk(m.text) && m.text.trim().length > 3,
  ).length;
}

export function isHireIntentMessage(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /^i (want|need) to hire\b/.test(t) ||
    /^hire (a |an )?/.test(t) ||
    (/^i need (a |an )?/.test(t) && /\b(engineer|developer|designer|analyst|rep|manager|specialist)\b/.test(t))
  );
}

export function userTextBlob(conversation: RecruiterMessage[]): string {
  return conversation
    .filter((m) => m.role === "user")
    .map((m) => m.text)
    .join(" ");
}

export function adeAskedAbout(topic: RegExp, conversation: RecruiterMessage[]): boolean {
  return conversation.some((m) => m.role === "ade" && topic.test(m.text));
}

export function userAnsweredAfterAdeAsked(topic: RegExp, conversation: RecruiterMessage[]): boolean {
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    if (msg.role !== "ade" || !topic.test(msg.text)) continue;
    const followUp = conversation.slice(i + 1).find((m) => m.role === "user");
    if (followUp && followUp.text.trim().length > 1) return true;
  }
  return false;
}

export function hasEngineeringDiscipline(
  brief: AiEmployeeJobBrief,
  conversation: RecruiterMessage[],
): boolean {
  const blob = userTextBlob(conversation);
  if (ENGINEERING_DISCIPLINE_PATTERNS.some((p) => p.test(blob))) return true;
  const focusHaystack = [...brief.technicalFocus, ...brief.businessFocus].join(" ");
  return ENGINEERING_DISCIPLINE_PATTERNS.some((p) => p.test(focusHaystack));
}

export function hasProductContext(
  brief: AiEmployeeJobBrief,
  conversation: RecruiterMessage[],
): boolean {
  const blob = userTextBlob(conversation);
  if (PRODUCT_CONTEXT_PATTERNS.some((p) => p.test(blob))) return true;
  if (brief.domain.trim() && !isGenericEngineeringDomain(brief.domain)) return true;
  return userAnsweredAfterAdeAsked(
    /stack|product area|work with first|next\.js|supabase|something else/i,
    conversation,
  );
}

export function isGenericEngineeringDomain(domain?: string): boolean {
  if (!domain?.trim()) return true;
  const lower = domain.toLowerCase().trim();
  return [
    "software engineering",
    "engineering",
    "engineering & technical",
    "general business",
    "general software",
  ].includes(lower);
}

export function hasUserConfirmedSeniority(conversation: RecruiterMessage[]): boolean {
  const blob = userTextBlob(conversation);
  if (SENIORITY_PATTERNS.some((p) => p.test(blob))) return true;
  return userAnsweredAfterAdeAsked(
    /how senior|judgment should they|architect|implementer|mid[- ]?level/i,
    conversation,
  );
}

export function toolsResolved(conversation: RecruiterMessage[]): boolean {
  const asked = adeAskedAbout(/tools|stack|plug into|from day one/i, conversation);
  if (!asked) return false;
  return userAnsweredAfterAdeAsked(/tools|stack|plug into|from day one/i, conversation);
}

export function approvalResolved(conversation: RecruiterMessage[]): boolean {
  const asked = adeAskedAbout(/approval|run by you|external messages|publishing|safety/i, conversation);
  if (!asked) return false;
  return userAnsweredAfterAdeAsked(/approval|run by you|external messages|publishing|safety/i, conversation);
}

export function userSkippedTopic(conversation: RecruiterMessage[], topic: RegExp): boolean {
  for (let i = 0; i < conversation.length; i++) {
    const msg = conversation[i];
    if (msg.role !== "ade" || !topic.test(msg.text)) continue;
    const followUp = conversation.slice(i + 1).find((m) => m.role === "user");
    if (followUp && SKIP_PATTERNS.test(followUp.text)) return true;
  }
  return false;
}

export function toolsOrSkipped(conversation: RecruiterMessage[]): boolean {
  return (
    toolsResolved(conversation) || userSkippedTopic(conversation, /tools|stack|plug into/i)
  );
}

export function approvalOrSkipped(conversation: RecruiterMessage[]): boolean {
  return (
    approvalResolved(conversation) ||
    userSkippedTopic(conversation, /approval|run by you|external messages/i)
  );
}
