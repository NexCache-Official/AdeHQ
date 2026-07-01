import type { AiEmployeeJobBrief } from "./types";

export type ChipMutationResult = {
  brief: AiEmployeeJobBrief;
  message: string;
  changedFields: string[];
  noop: boolean;
};

function cloneBrief(brief: AiEmployeeJobBrief): AiEmployeeJobBrief {
  return {
    ...brief,
    coreResponsibilities: [...brief.coreResponsibilities],
    technicalFocus: [...brief.technicalFocus],
    businessFocus: [...brief.businessFocus],
    successMetrics: [...brief.successMetrics],
    personalityTraits: [...brief.personalityTraits],
    approvalRules: [...brief.approvalRules],
    toolsNeeded: [...brief.toolsNeeded],
    assumptions: [...brief.assumptions],
    openQuestions: [...brief.openQuestions],
  };
}

function pushUnique(list: string[], item: string): boolean {
  if (list.includes(item)) return false;
  list.push(item);
  return true;
}

const CHIP_PATTERNS: Array<{
  match: RegExp;
  apply: (brief: AiEmployeeJobBrief) => ChipMutationResult;
}> = [
  {
    match: /make it more senior|senior advisor|more senior/i,
    apply: (brief) => {
      const next = cloneBrief(brief);
      const changed: string[] = [];
      if (next.seniorityLevel !== "manager" && next.seniorityLevel !== "advisor") {
        next.seniorityLevel = "manager";
        changed.push("seniorityLevel");
      }
      if (next.autonomyLevel !== "high") {
        next.autonomyLevel = "high";
        changed.push("autonomyLevel");
      }
      pushUnique(next.coreResponsibilities, "Make architecture and planning decisions");
      pushUnique(next.coreResponsibilities, "Review implementation quality and technical tradeoffs");
      changed.push("coreResponsibilities");
      pushUnique(next.successMetrics, "Technical quality and reliability");
      changed.push("successMetrics");
      pushUnique(next.personalityTraits, "senior");
      changed.push("personalityTraits");
      const noop =
        changed.length === 0 ||
        (brief.seniorityLevel === next.seniorityLevel &&
          brief.autonomyLevel === next.autonomyLevel &&
          brief.coreResponsibilities.length === next.coreResponsibilities.length);
      return {
        brief: next,
        changedFields: changed,
        noop,
        message: noop
          ? "That's already reflected in the brief. Want me to generate candidates or adjust another part?"
          : "Updated — I've made this a senior, more autonomous role with architecture judgment and implementation review responsibility.",
      };
    },
  },
  {
    match: /make it more hands-on|hands-on|implementation-focused/i,
    apply: (brief) => {
      const next = cloneBrief(brief);
      const changed: string[] = [];
      if (next.seniorityLevel !== "specialist") {
        next.seniorityLevel = "specialist";
        changed.push("seniorityLevel");
      }
      if (next.autonomyLevel === "high") {
        next.autonomyLevel = "balanced";
        changed.push("autonomyLevel");
      }
      pushUnique(next.coreResponsibilities, "Ship implementation work directly with clear delivery loops");
      changed.push("coreResponsibilities");
      pushUnique(next.businessFocus, "Execution and delivery");
      changed.push("businessFocus");
      pushUnique(next.personalityTraits, "practical");
      pushUnique(next.personalityTraits, "delivery-focused");
      changed.push("personalityTraits");
      const noop =
        brief.seniorityLevel === next.seniorityLevel &&
        brief.autonomyLevel === next.autonomyLevel &&
        brief.personalityTraits.includes("practical");
      return {
        brief: next,
        changedFields: changed,
        noop,
        message: noop
          ? "That's already reflected in the brief. Want me to generate candidates or adjust another part?"
          : "Updated — I've made the role more hands-on and implementation-focused.",
      };
    },
  },
  {
    match: /^add tools$/i,
    apply: (brief) => ({
      brief,
      changedFields: [],
      noop: false,
      message:
        "Which tools should they use? Common picks are GitHub, Supabase, Vercel, Linear, Slack, browser, or email — or none yet.",
    }),
  },
  {
    match: /github/i,
    apply: (brief) => {
      const next = cloneBrief(brief);
      const added = pushUnique(next.toolsNeeded, "GitHub");
      return {
        brief: next,
        changedFields: added ? ["toolsNeeded"] : [],
        noop: !added,
        message: added
          ? "Added GitHub to the tools list."
          : "GitHub is already in the brief. Anything else to adjust?",
      };
    },
  },
  {
    match: /supabase/i,
    apply: (brief) => {
      const next = cloneBrief(brief);
      const added = pushUnique(next.toolsNeeded, "Supabase");
      return {
        brief: next,
        changedFields: added ? ["toolsNeeded"] : [],
        noop: !added,
        message: added ? "Added Supabase to the tools list." : "Supabase is already listed.",
      };
    },
  },
  {
    match: /vercel/i,
    apply: (brief) => {
      const next = cloneBrief(brief);
      const added = pushUnique(next.toolsNeeded, "Vercel");
      return {
        brief: next,
        changedFields: added ? ["toolsNeeded"] : [],
        noop: !added,
        message: added ? "Added Vercel to the tools list." : "Vercel is already listed.",
      };
    },
  },
  {
    match: /linear/i,
    apply: (brief) => {
      const next = cloneBrief(brief);
      const added = pushUnique(next.toolsNeeded, "Linear");
      return {
        brief: next,
        changedFields: added ? ["toolsNeeded"] : [],
        noop: !added,
        message: added ? "Added Linear to the tools list." : "Linear is already listed.",
      };
    },
  },
  {
    match: /refine responsibilities/i,
    apply: (brief) => ({
      brief,
      changedFields: [],
      noop: false,
      message: `Which responsibility should we sharpen first? Current focus areas include ${brief.coreResponsibilities.slice(0, 3).join(", ") || "general execution"}.`,
    }),
  },
];

export function applyChipMutation(
  instruction: string,
  brief: AiEmployeeJobBrief,
): ChipMutationResult | null {
  const trimmed = instruction.trim();
  if (!trimmed) return null;
  for (const pattern of CHIP_PATTERNS) {
    if (pattern.match.test(trimmed)) {
      return pattern.apply(brief);
    }
  }
  return null;
}

export const READY_BRIEF_PHRASE = "I have enough to draft a strong job brief";

export function recruiterReadyMessage(brief: AiEmployeeJobBrief): string {
  const seniority =
    brief.seniorityLevel === "advisor" || brief.seniorityLevel === "manager"
      ? "senior"
      : brief.seniorityLevel === "specialist"
        ? "mid-level"
        : "focused";
  const focus =
    brief.technicalFocus[0] ??
    brief.coreResponsibilities[0] ??
    brief.businessFocus[0] ??
    "the work you described";
  return `I have enough to draft a strong brief. I've set this up as a ${brief.roleTitle.toLowerCase()} with ${seniority} autonomy around ${focus.toLowerCase()}. You can review the brief or generate candidates.`;
}
