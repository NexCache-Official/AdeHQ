/** User-facing memory categories for browsing and AI retrieval. */
export const MEMORY_CATEGORIES = [
  "Company Context",
  "Product / Service",
  "Market Research",
  "Sales",
  "Customer / Client",
  "Marketing",
  "Operations",
  "Decision",
  "Preference",
  "People / Workforce",
  "Process / Playbook",
  "File Finding",
  "Topic Summary",
  "Employee-Specific Context",
  "Other",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export type MemoryScope =
  | "workspace"
  | "room"
  | "topic"
  | "employee_dm"
  | "employee_profile"
  | "employee";

export type MemorySourceType =
  | "message"
  | "topic_summary"
  | "file"
  | "artifact"
  | "manual"
  | "ai_suggestion"
  | "search_distill"
  | "work_log"
  | "hiring_session";

/** Map legacy MemoryType slug to a display category. */
export function legacyTypeToCategory(type: string): MemoryCategory {
  switch (type) {
    case "decision":
      return "Decision";
    case "research":
      return "Market Research";
    case "architecture":
      return "Product / Service";
    case "preference":
      return "Preference";
    case "instruction":
      return "Process / Playbook";
    default:
      return "Other";
  }
}

export function categoryToLegacyType(category: MemoryCategory): import("@/lib/types").MemoryType {
  switch (category) {
    case "Decision":
      return "decision";
    case "Market Research":
      return "research";
    case "Product / Service":
      return "architecture";
    case "Preference":
      return "preference";
    case "Process / Playbook":
      return "instruction";
    default:
      return "general";
  }
}

export function normalizeCategory(value?: string | null): MemoryCategory {
  if (!value?.trim()) return "Other";
  const match = MEMORY_CATEGORIES.find((c) => c.toLowerCase() === value.trim().toLowerCase());
  if (match) return match;
  const partial = MEMORY_CATEGORIES.find((c) =>
    value.toLowerCase().includes(c.toLowerCase().split("/")[0]?.trim() ?? ""),
  );
  return partial ?? "Other";
}

/** Deterministic category inference from text (V0 — no extra LLM call on save). */
export function inferMemoryCategory(text: string, reason?: string): MemoryCategory {
  const hay = `${text} ${reason ?? ""}`.toLowerCase();
  if (/topic summary|workstream summary/i.test(hay)) return "Topic Summary";
  if (/market research|market sizing|competitor|tam\b|segment/i.test(hay)) return "Market Research";
  if (/sales outreach|cold email|pipeline|prospect|outreach plan/i.test(hay)) return "Sales";
  if (/marketing channel|campaign|seo\b|ads\b|brand/i.test(hay)) return "Marketing";
  if (/customer|client|user research|feedback/i.test(hay)) return "Customer / Client";
  if (/decision|decided|direction|owns\b|ownership/i.test(hay)) return "Decision";
  if (/preference|prefer\b|always\b|never\b/i.test(hay)) return "Preference";
  if (/employee|workforce|hire|role\b|team member/i.test(hay)) return "People / Workforce";
  if (/process|playbook|workflow|sop\b|checklist/i.test(hay)) return "Process / Playbook";
  if (/file|document|pdf|upload|extracted/i.test(hay)) return "File Finding";
  if (/product|service|feature|roadmap|prd/i.test(hay)) return "Product / Service";
  if (/operations|ops\b|logistics|supply/i.test(hay)) return "Operations";
  if (/company|workspace|business context|launching/i.test(hay)) return "Company Context";
  return "Other";
}

export function inferMemoryTags(text: string, category: MemoryCategory): string[] {
  const tags = new Set<string>();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && w.length < 24);
  const stop = new Set(["that", "this", "with", "from", "have", "will", "need", "about", "their", "they"]);
  for (const word of words) {
    if (stop.has(word)) continue;
    tags.add(word.charAt(0).toUpperCase() + word.slice(1));
    if (tags.size >= 6) break;
  }
  if (category !== "Other") tags.add(category.split("/")[0]?.trim() ?? category);
  return [...tags].slice(0, 6);
}
