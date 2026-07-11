const DEPARTMENT_FALLBACKS: Record<string, string> = {
  product: "Product Manager",
  engineering: "Software Engineer",
  design: "Product Designer",
  research: "Market Research Analyst",
  marketing: "Marketing Specialist",
  sales: "Sales Development Representative",
  support: "Customer Support Specialist",
  operations: "Operations Coordinator",
  finance: "Finance Analyst",
  legal: "Legal Review Specialist",
  hr: "People Operations Specialist",
  pr: "PR Manager",
  gamedev: "Game Developer",
};

const KNOWN_TITLES = [
  "software engineer",
  "product engineer",
  "full-stack software engineer",
  "full stack software engineer",
  "ai systems engineer",
  "ai performance engineer",
  "saas platform engineer",
  "product manager",
  "pr manager",
  "sales development representative",
  "market research analyst",
  "customer support specialist",
  "legal review specialist",
  "data science engineer",
];

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.toLowerCase() === "ai" || word.toLowerCase() === "saas"
      ? word.toUpperCase()
      : word[0]?.toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

const TITLE_SUFFIX_WORDS = [
  "manager",
  "engineer",
  "analyst",
  "designer",
  "specialist",
  "representative",
  "agent",
  "coordinator",
  "officer",
  "assistant",
  "associate",
];

const TITLE_SUFFIX_REGEX = new RegExp(`\\b(?:${TITLE_SUFFIX_WORDS.join("|")})\\b`, "i");

const ROLE_PHRASE_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "someone",
  "who",
  "can",
  "is",
  "are",
  "for",
  "to",
  "need",
  "needs",
  "want",
  "wants",
  "hire",
  "find",
  "get",
  "our",
  "my",
]);

/** Pulls a short "<modifier> <title>" noun phrase out of a longer free-text role request. */
function extractRoleTitlePhrase(raw: string): string | null {
  const suffixPattern = TITLE_SUFFIX_WORDS.join("|");
  const match = raw.match(new RegExp(`\\b((?:[a-zA-Z]+[\\s-]+){0,3})(${suffixPattern})\\b`, "i"));
  if (!match) return null;

  const modifiers = match[1]
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter((word) => !ROLE_PHRASE_STOPWORDS.has(word.toLowerCase()))
    .slice(-2);

  return [...modifiers, match[2]].join(" ");
}

export function synthesizeRoleTitle(input: {
  roleInput: string;
  department?: string | null;
  domain?: string;
  technicalFocus?: string[];
  businessFocus?: string[];
}): string {
  const combined = [
    input.roleInput,
    input.domain,
    ...(input.technicalFocus ?? []),
    ...(input.businessFocus ?? []),
  ]
    .join(" ")
    .toLowerCase();
  const raw = input.roleInput.trim();
  const normalized = raw.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");

  if (KNOWN_TITLES.includes(normalized)) {
    return titleCase(normalized.replace("full stack", "full-stack"));
  }

  if (includesAny(combined, ["latency", "bandwidth", "performance", "inference", "throughput"])) {
    return "AI Performance Engineer";
  }
  if (includesAny(combined, ["saas platform", "platform engineering", "platform features"])) {
    return "SaaS Platform Engineer";
  }
  if (includesAny(combined, ["data science", "ml workflow", "machine learning", "analytics workflow"])) {
    return "Data Science Engineer";
  }
  if (
    includesAny(combined, ["write code", "build and ship", "build, and ship", "ship features", "product features"])
  ) {
    return "Software Engineer";
  }
  if (includesAny(combined, ["backend", "systems", "api", "infrastructure"])) {
    return "Backend Systems Engineer";
  }
  if (includesAny(combined, ["frontend", "ui", "react", "interface"])) {
    return "Frontend Product Engineer";
  }
  if (includesAny(combined, ["press", "media", "coverage", "investor"])) {
    return "PR Manager";
  }
  if (includesAny(combined, ["leads", "outreach", "sales email", "qualify"])) {
    return "Sales Development Representative";
  }
  if (includesAny(combined, ["competitor", "market size", "research"])) {
    return "Market Research Analyst";
  }
  if (includesAny(combined, ["support tickets", "customers", "customer support"])) {
    return "Customer Support Specialist";
  }

  if (input.department && DEPARTMENT_FALLBACKS[input.department]) {
    return DEPARTMENT_FALLBACKS[input.department];
  }

  if (raw && raw.split(/\s+/).length <= 4 && TITLE_SUFFIX_REGEX.test(raw)) {
    return titleCase(raw);
  }

  if (raw && TITLE_SUFFIX_REGEX.test(raw)) {
    const phrase = extractRoleTitlePhrase(raw);
    if (phrase) return titleCase(phrase);
  }

  return "AI Employee";
}
