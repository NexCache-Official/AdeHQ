import { DEPARTMENT_CARDS } from "./data";
import { normalizeRecruiterAnswer } from "./normalize-recruiter-answer";
import type {
  AiEmployeeJobBrief,
  RecruiterMessage,
  RecruiterReadiness,
  RecruiterSuggestionChip,
} from "./types";

const NOT_SURE = "Not sure — help me decide";

function pushChip(
  chips: RecruiterSuggestionChip[],
  label: string,
  value: string,
  intent: RecruiterSuggestionChip["intent"] = "answer_question",
) {
  chips.push({
    id: `${intent}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    label,
    value,
    intent,
  });
}

function chipsFromLabels(
  labels: string[],
  intent: RecruiterSuggestionChip["intent"] = "answer_question",
  max = 5,
): RecruiterSuggestionChip[] {
  const chips: RecruiterSuggestionChip[] = [];
  for (const label of labels.slice(0, max)) {
    pushChip(chips, label, label, intent);
  }
  return chips;
}

export function inferDepartmentId(brief: AiEmployeeJobBrief): string {
  const byName = DEPARTMENT_CARDS.find((d) => d.name.toLowerCase() === brief.department.toLowerCase());
  if (byName && byName.id !== "custom") return byName.id;

  const haystack = `${brief.roleTitle} ${brief.domain} ${brief.department}`.toLowerCase();
  if (/\b(pr|press|media|communications?)\b/.test(haystack)) return "pr";
  if (/\b(marketing|content|campaign|seo)\b/.test(haystack)) return "marketing";
  if (/\b(sales|outreach|pipeline|crm)\b/.test(haystack)) return "sales";
  if (/\b(product|roadmap|prd)\b/.test(haystack)) return "product";
  if (/\b(design|ux|ui|wireframe)\b/.test(haystack)) return "design";
  if (/\b(research|competitor|market)\b/.test(haystack)) return "research";
  if (/\b(support|ticket|customer success)\b/.test(haystack)) return "support";
  if (/\b(operations|ops|coordination)\b/.test(haystack)) return "operations";
  if (/\b(finance|accounting|budget)\b/.test(haystack)) return "finance";
  if (/\b(legal|contract|compliance)\b/.test(haystack)) return "legal";
  if (/\b(hr|hiring|people ops)\b/.test(haystack)) return "hr";
  if (/\b(game|gamedev|player)\b/.test(haystack)) return "gamedev";
  if (/\b(engineer|software|backend|frontend|devops|sre)\b/.test(haystack)) return "engineering";
  return "custom";
}

export function isEngineeringBrief(brief: AiEmployeeJobBrief): boolean {
  const deptId = inferDepartmentId(brief);
  if (deptId === "engineering") return true;
  const title = brief.roleTitle.toLowerCase();
  return /\b(software engineer|backend engineer|frontend engineer|full[- ]?stack|devops|sre|platform engineer)\b/.test(
    title,
  );
}

function parseInlineOptionList(segment: string): string[] {
  let cleaned = segment.split("?")[0].split("\n")[0];
  cleaned = cleaned.replace(/^(will it focus on|should it|could it|would it)\s+/i, "");
  cleaned = cleaned.replace(/\s+or something else.*$/i, "");
  cleaned = cleaned.replace(/\s+just give me.*$/i, "");
  cleaned = cleaned.replace(/\s+etc\.?\)?\.*$/i, "");

  const parts = cleaned
    .split(/,\s*/)
    .flatMap((part) => part.split(/\s+or\s+/i))
    .map((part) => normalizeRecruiterAnswer(part))
    .filter((part) => part.length > 2 && part.length < 80)
    .filter((part) => !/something else|not sure|help me decide|^etc$/i.test(part));

  return parts;
}

export type RecruiterQuestionTopic =
  | "stack"
  | "channels"
  | "domain"
  | "core_work"
  | "technical_focus"
  | "business_focus"
  | "seniority"
  | "communication_style"
  | "quality_preference"
  | "tools"
  | "approval_rules";

/** Infer what Maya's last question is asking — used by tests and diagnostics. */
export function inferQuestionTopicFromRecruiterMessage(text: string): RecruiterQuestionTopic | null {
  const lower = text.toLowerCase();
  if (
    /\b(channels?|linkedin|instagram|tiktok|twitter|\bx\b)\b/.test(lower) &&
    !/\b(tech stack|frameworks|frontend and backend)\b/.test(lower)
  ) {
    return "channels";
  }
  if (
    /\b(tech stack|frameworks|frontend and backend|language.*use|stack does your team|what specific frontend)\b/.test(
      lower,
    )
  ) {
    return "stack";
  }
  if (
    /\bhow senior|judgment should they|hands[- ]?on executor|steady mid[- ]?level|senior advisor|architect|implementer\b/.test(
      lower,
    )
  ) {
    return "seniority";
  }
  if (/\btools|plug into|from day one|systems should they\b/.test(lower)) {
    return "tools";
  }
  if (/\bapproval|run by you|external messages|publishing|sign[- ]?off\b/.test(lower)) {
    return "approval_rules";
  }
  if (/\b(show up|communication|tone|voice|formal|collaborative|async)\b/.test(lower)) {
    return "communication_style";
  }
  if (/\bmoving fast|balanced output|polish|quality.*speed|bias toward\b/.test(lower)) {
    return "quality_preference";
  }
  if (
    /\bfocus on.{0,100}(frontend|backend|full[- ]?stack|qa|infrastructure)\b/.test(lower) ||
    (/\bshould this (engineer|employee|hire)\b/.test(lower) && /\bor qa\b/.test(lower))
  ) {
    return "technical_focus";
  }
  if (/\bwhat product|what market|product or platform|part of the business|customer segment\b/.test(lower)) {
    return "domain";
  }
  if (/\boutcomes should|drive in the next|business focus\b/.test(lower)) {
    return "business_focus";
  }
  if (/\b(day to day|own first|what should this|core work|focus on day)\b/.test(lower)) {
    return "core_work";
  }
  return null;
}

/** Pull comma/or-separated options from the question sentence before "?". */
export function extractOptionListBeforeQuestion(text: string): string[] {
  const qIdx = text.lastIndexOf("?");
  if (qIdx <= 0) return [];

  const beforeQuestion = text.slice(0, qIdx);
  const listPatterns = [
    /\bfocus on\s+(.+)$/i,
    /\bshould (?:this|they|the|it)\s+[^?]{0,60}?\s+focus on\s+(.+)$/i,
    /\b(?:choose|pick|select)\s+(?:from\s+)?(.+)$/i,
  ];

  for (const pattern of listPatterns) {
    const match = beforeQuestion.match(pattern);
    if (match?.[1]) {
      const parts = parseInlineOptionList(match[1]);
      if (parts.length >= 2) return parts;
    }
  }

  const lastSentence = beforeQuestion.split(/[.!]\s+/).pop() ?? beforeQuestion;
  if (/,/.test(lastSentence) && /\bor\b/i.test(lastSentence)) {
    const inline = parseInlineOptionList(lastSentence.replace(/^.*?\b(should|focus on|would|are they|is it)\b/i, ""));
    if (inline.length >= 2) return inline;
  }

  return [];
}

/** Pull example answers from Ade's last question when she lists options inline. */
export function extractExamplesFromRecruiterMessage(text: string): string[] {
  const segments: string[] = [];
  const lower = text.toLowerCase();

  const parenEg = text.match(/\(\s*e\.?\s*g\.?\s*,?\s*([^)]+)\)/i);
  if (parenEg?.[1]) {
    segments.push(parenEg[1]);
  }

  const dashIdx = text.lastIndexOf("—");
  if (dashIdx >= 0) {
    segments.push(text.slice(dashIdx + 1));
  }

  const colonMatch = text.match(
    /(?:what|which|are they|should they|is it|who)\s+[^:?\n]{0,120}:\s*([^?\n]+)/i,
  );
  if (colonMatch?.[1]) {
    segments.push(colonMatch[1]);
  }

  for (const marker of ["for example", "such as", "e.g.", "e.g.,", "like "]) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) {
      segments.push(text.slice(idx + marker.length));
      break;
    }
  }

  for (const segment of segments) {
    const parts = parseInlineOptionList(segment);
    if (parts.length >= 2) return parts;
    if (parts.length === 1 && segment.includes("+")) return parts;
  }

  return [];
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    const key = label.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label.trim());
  }
  return out;
}

function matchesUserAnswer(label: string, answer: string): boolean {
  const a = answer.trim().toLowerCase();
  const b = label.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function isValidChipLabel(label: string, lastAde: string): boolean {
  const trimmed = label.trim();
  if (trimmed.length < 2 || trimmed.length > 48) return false;
  if (/^(what|which|how|when|where|why|narrow down)\b/i.test(trimmed)) return false;
  if (/\b(technologies|tech stack|frontend and backend)\b/i.test(trimmed)) {
    return /\b(tech stack|frameworks|frontend and backend|react|node)\b/i.test(lastAde.toLowerCase());
  }
  return true;
}

function buildChipsFromLastRecruiterMessage(
  lastAde: string,
  lastUser: string,
): RecruiterSuggestionChip[] | null {
  const fromExamples = extractExamplesFromRecruiterMessage(lastAde);
  const fromOptionList = extractOptionListBeforeQuestion(lastAde);
  const inlineLabels = uniqueLabels(
    [...fromExamples, ...fromOptionList]
      .filter((label) => isValidChipLabel(label, lastAde))
      .filter((label) => !matchesUserAnswer(label, lastUser)),
  );

  if (inlineLabels.length >= 2) {
    const chips = chipsFromLabels(inlineLabels, "answer_question", 4);
    pushChip(chips, NOT_SURE, NOT_SURE);
    return chips;
  }

  if (inlineLabels.length === 1) {
    return chipsFromLabels([inlineLabels[0], NOT_SURE], "answer_question", 2);
  }

  return null;
}

/** Parse chips only from Maya's latest message — no hardcoded dept templates. */
export function parseRecruiterSuggestionChips(
  conversation: RecruiterMessage[] = [],
  _roleKey?: string | null,
): RecruiterSuggestionChip[] {
  const lastAde = [...conversation].reverse().find((message) => message.role === "ade")?.text ?? "";
  const lastUser = [...conversation].reverse().find((message) => message.role === "user")?.text.trim() ?? "";

  const parsed = buildChipsFromLastRecruiterMessage(lastAde, lastUser);
  if (parsed?.length) return parsed;

  return chipsFromLabels([NOT_SURE]);
}

export function generateSuggestionChips(
  readiness: RecruiterReadiness,
  _currentBrief: AiEmployeeJobBrief,
  conversation: RecruiterMessage[] = [],
  roleKey?: string | null,
  canReviewBrief = false,
): RecruiterSuggestionChip[] {
  if (readiness.ready || canReviewBrief) {
    const chips: RecruiterSuggestionChip[] = [
      {
        id: "review-brief",
        label: "Review job brief",
        value: "Review job brief",
        intent: "review_brief",
      },
      {
        id: "gen-candidates",
        label: "Generate candidates",
        value: "Generate candidates",
        intent: "answer_question",
      },
      {
        id: "refine-responsibilities",
        label: "Refine responsibilities",
        value: "Refine responsibilities",
        intent: "refine_more",
      },
    ];
    pushChip(chips, NOT_SURE, NOT_SURE);
    return chips;
  }

  return parseRecruiterSuggestionChips(conversation, roleKey);
}
