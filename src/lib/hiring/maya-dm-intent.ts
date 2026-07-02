import { inferRoleFromText } from "./role-inference";
import { isHiringSmallTalk } from "./maya-recruiter-state";

export type MayaDmIntent =
  | "workspace_guide"
  | "hiring"
  | "small_talk"
  | "generate_candidates"
  | "hire_recommended"
  | "general_chat";

const WORKSPACE_GUIDE_PATTERNS = [
  /how (does|do|is|are|can).*(adehq|workforce|workspace|this (app|platform)|things work)/i,
  /what (is|are|does).*(adehq|workforce|maya do|this platform)/i,
  /explain.*(workforce|adehq|workspace|how (this|things) work)/i,
  /how (can|do) i (use|navigate|find|manage)/i,
  /where (is|are|do i find|can i)/i,
  /tell me about (adehq|the workforce|maya)/i,
  /what can (you|maya) do(?!.*hire)/i,
  /help me understand (adehq|the workspace|workforce)/i,
];

const EXPLICIT_HIRING_PATTERNS = [
  /\bhire (a|an|the)\b/i,
  /\bneed (a|an) .*(analyst|engineer|manager|assistant|specialist|rep|developer|designer|writer|coordinator)/i,
  /\blooking for (a|an)\b/i,
  /\brecruit(ing|ment)?\b/i,
  /\bshortlist\b/i,
  /\bjob brief\b/i,
  /\bnew (ai )?employee\b/i,
  /\bmarket research analyst\b/i,
  /\bsoftware engineer\b/i,
  /\bproduct manager\b/i,
];

export function isWorkspaceGuideQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (EXPLICIT_HIRING_PATTERNS.some((p) => p.test(trimmed))) return false;
  return WORKSPACE_GUIDE_PATTERNS.some((p) => p.test(trimmed));
}

export function isExplicitHiringIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (EXPLICIT_HIRING_PATTERNS.some((p) => p.test(trimmed))) return true;
  const inference = inferRoleFromText(trimmed);
  return inference.confidence === "high" && inference.matches.length > 0;
}

export function classifyMayaDmIntent(
  text: string,
  opts?: { inHiringTopic?: boolean; hasHiringMessages?: boolean },
): MayaDmIntent {
  const trimmed = text.trim();
  if (!trimmed) return "general_chat";

  if (/generate candidates/i.test(trimmed) || /show (me )?candidates/i.test(trimmed)) {
    return "generate_candidates";
  }
  if (/hire (the )?recommended/i.test(trimmed) || /hire (them|this one)/i.test(trimmed)) {
    return "hire_recommended";
  }
  if (isHiringSmallTalk(trimmed)) return "small_talk";

  if (opts?.inHiringTopic || opts?.hasHiringMessages) {
    if (isWorkspaceGuideQuestion(trimmed) && !isExplicitHiringIntent(trimmed)) {
      return "workspace_guide";
    }
    return "hiring";
  }

  if (isWorkspaceGuideQuestion(trimmed)) return "workspace_guide";
  if (isExplicitHiringIntent(trimmed)) return "hiring";

  const inference = inferRoleFromText(trimmed);
  if (inference.confidence === "medium" && inference.matches.length > 0) {
    return "hiring";
  }

  return "general_chat";
}

export function workspaceGuideReply(text: string, firstName = "there"): string {
  const lower = text.toLowerCase();

  if (/workforce|ai employee|how does adehq|how (does|do) (this|things) work/.test(lower)) {
    return `Hey ${firstName} — AdeHQ is where your team and AI employees work together. Use Rooms for shared work, Direct messages for 1:1 with any employee, and Topics inside a room to split workstreams. The Workforce page is your roster — open someone to tune instructions, tools, and approvals. When you want a new hire, tell me the role and I'll open a hiring topic so this main chat stays free for everyday questions.`;
  }
  if (/room|topic|channel/.test(lower)) {
    return `Rooms are shared spaces for humans and AI employees. Inside each room, Topics keep context focused — Direct Chat is the main thread in DMs; add topics when a conversation needs its own workstream (like a hiring session). Mention someone with @ when you want their help.`;
  }
  if (/task|approval|memory/.test(lower)) {
    return `Tasks track open work. Approvals are sign-offs before an AI employee takes sensitive actions. Memory stores facts the team wants to keep. All of these tie back to rooms and topics so context stays in the right place.`;
  }
  if (/maya|what can you/.test(lower)) {
    return `I'm Maya — your AI Workforce Manager. I help you hire the right AI employees, shape job briefs, and navigate AdeHQ. Ask me how anything works here, or say something like "hire a market research analyst" when you're ready to recruit.`;
  }

  return `Good question. AdeHQ centers on rooms, topics, and your AI workforce — I'm happy to walk you through any part of it. What would be most useful: hiring someone new, or finding your way around the workspace?`;
}
