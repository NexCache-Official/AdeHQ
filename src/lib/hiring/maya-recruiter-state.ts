import type { BriefComposeSection } from "./detect-brief-change";

export type MayaRecruiterState =
  | "idle"
  | "acknowledging"
  | "thinking"
  | "updating_brief"
  | "ready_to_review"
  | "error";

export type BriefUpdateSection =
  | "roleTitle"
  | "mission"
  | "coreResponsibilities"
  | "technicalFocus"
  | "businessFocus"
  | "successMetrics"
  | "communicationStyle"
  | "approvalRules";

export type BriefUpdateState = {
  status: "idle" | "updating" | "updated" | "error";
  sectionsUpdating: BriefUpdateSection[];
  lastUpdatedAt?: string;
};

export const INITIAL_BRIEF_UPDATE_STATE: BriefUpdateState = {
  status: "idle",
  sectionsUpdating: [],
};

const SMALL_TALK_RE =
  /^(hi|hey|hello|yo|sup|thanks|thank you|thx|ok|okay|cool|great|got it|sounds good|perfect|nice|cheers|bye|goodbye|good morning|good afternoon|good evening)[!.?]*$/i;

export function isHiringSmallTalk(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (SMALL_TALK_RE.test(trimmed)) return true;
  if (trimmed.length <= 12 && /^(hi|hey|hello)\b/i.test(trimmed)) return true;
  return false;
}

const OPTIMISTIC_ACKS = [
  "Got it — updating the brief with that.",
  "Makes sense — folding this in now.",
  "Helpful — I'll reflect that in the role brief.",
  "Clear — shaping the brief around that.",
];

export function pickOptimisticAck(seed?: string): string {
  const trimmed = seed?.trim() ?? "";
  if (trimmed) {
    const short = trimmed.length > 48 ? `${trimmed.slice(0, 45)}…` : trimmed;
    const contextual = [
      `Got it — ${short}. Updating the brief.`,
      `${short} — noted. I'll fold that into the brief.`,
      `Makes sense — ${short}. One sec while I update the brief.`,
    ];
    let hash = 0;
    for (let i = 0; i < trimmed.length; i += 1) {
      hash = (hash + trimmed.charCodeAt(i) * (i + 1)) % contextual.length;
    }
    return contextual[hash];
  }
  return OPTIMISTIC_ACKS[0];
}

export function inferSectionsUpdating(message: string): BriefUpdateSection[] {
  const lower = message.toLowerCase();
  const sections = new Set<BriefUpdateSection>();

  if (
    /\b(api|code|engineering|frontend|backend|infra|technical|stack|deploy|database|latency|performance|ai|ml|data)\b/.test(
      lower,
    )
  ) {
    sections.add("technicalFocus");
  }
  if (/\b(metric|kpi|goal|success|outcome|target|measure)\b/.test(lower)) {
    sections.add("successMetrics");
  }
  if (/\b(tone|personality|communication|style|voice|verbose|proactive|friendly|formal)\b/.test(lower)) {
    sections.add("communicationStyle");
  }
  if (/\b(approval|permission|risk|sign.?off|escalat)\b/.test(lower)) {
    sections.add("approvalRules");
  }
  if (/\b(revenue|customer|sales|market|business|growth|pipeline)\b/.test(lower)) {
    sections.add("businessFocus");
  }
  if (/\b(title|role|position|senior|manager|director|advisor)\b/.test(lower)) {
    sections.add("roleTitle");
  }

  if (sections.size === 0) {
    sections.add("mission");
    sections.add("coreResponsibilities");
  }

  return [...sections];
}

export function briefSectionToComposeKey(section: BriefUpdateSection): BriefComposeSection | null {
  switch (section) {
    case "roleTitle":
      return "title";
    case "mission":
      return "mission";
    case "coreResponsibilities":
      return "coreResponsibilities";
    case "technicalFocus":
      return "technicalFocus";
    case "businessFocus":
      return "businessFocus";
    case "successMetrics":
      return "successMetrics";
    case "communicationStyle":
    case "approvalRules":
      return "meta";
    default:
      return null;
  }
}

export function sectionUpdatingLabel(section: BriefUpdateSection): string {
  const labels: Record<BriefUpdateSection, string> = {
    roleTitle: "role title",
    mission: "mission",
    coreResponsibilities: "responsibilities",
    technicalFocus: "technical focus",
    businessFocus: "business focus",
    successMetrics: "success metrics",
    communicationStyle: "communication style",
    approvalRules: "approval rules",
  };
  return labels[section];
}

export function primaryUpdatingLabel(sections: BriefUpdateSection[]): string {
  if (sections.length === 0) return "job brief";
  return sectionUpdatingLabel(sections[0]);
}
