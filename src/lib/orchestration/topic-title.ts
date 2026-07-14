/** Clean steward/LLM topic titles so UI never shows truncated mid-phrase junk. */

const JUNK_TITLE =
  /^(project|follow.?up|discussion|general|workstream|misc|team|yes|no|ok|emily|adrian|wren|priya|maya)\b/i;

export function cleanTopicTitle(raw: string, maxLen = 56): string | null {
  let title = raw.replace(/\s+/g, " ").trim();
  if (!title) return null;

  // Drop trailing incomplete parentheticals / cutoffs: "(6", "(Canterbury…", "for..."
  title = title
    .replace(/\s*\([^)]*$/g, "")
    .replace(/\s+\d+\s*$/g, "")
    .replace(/\s*(?:for|and|with|the|a|an|of|to|in|on|at|&|\+|—|-)\s*$/i, "")
    .replace(/\.{2,}$/g, "")
    .replace(/[,:;]\s*$/g, "")
    .trim();

  if (title.length > maxLen) {
    const sliced = title.slice(0, maxLen);
    const boundary = Math.max(sliced.lastIndexOf(" "), sliced.lastIndexOf("-"));
    title = (boundary >= 24 ? sliced.slice(0, boundary) : sliced).trim();
    title = title.replace(/\s*(?:for|and|with|the|a|an|of|to|in|on|at|&|\+|—|-)\s*$/i, "").trim();
  }

  if (title.length < 3) return null;
  if (JUNK_TITLE.test(title) && title.split(/\s+/).length <= 2) return null;
  // Reject bare person-name titles
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/.test(title) && !/\b(Plus|Shield|Launch|Plan|Package)\b/.test(title)) {
    return null;
  }

  return title;
}

export function cleanTopicDescription(raw: string | undefined, title: string, maxLen = 180): string {
  let description = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!description) {
    return `Focused workstream for ${title}.`;
  }
  // Avoid echoing a truncated title as the whole description.
  if (description.startsWith(`Focused workstream for ${title}`)) {
    return description.length > 40 ? description.slice(0, maxLen).trim() : `Workstream for ${title}.`;
  }
  description = description
    .replace(/\s*\([^)]*$/g, "")
    .replace(/\.{2,}$/g, "")
    .trim();
  if (description.length > maxLen) {
    const sliced = description.slice(0, maxLen);
    const boundary = sliced.lastIndexOf(" ");
    description = (boundary >= 40 ? sliced.slice(0, boundary) : sliced).trim();
  }
  if (!/[.!?]$/.test(description)) description = `${description}.`;
  return description;
}

/** Significant tokens from a topic title for message relevance filtering. */
export function titleRelevanceTokens(title: string): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "a",
    "an",
    "of",
    "to",
    "in",
    "on",
    "at",
    "plus",
    "package",
    "launch",
    "pricing",
    "ops",
    "sales",
    "limits",
  ]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !stop.has(t))
    .slice(0, 8);
}

export function messageMatchesTitleTokens(content: string, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const lower = content.toLowerCase();
  const hits = tokens.filter((t) => lower.includes(t)).length;
  // Require at least one strong token hit, or 2+ when many tokens.
  return tokens.length <= 2 ? hits >= 1 : hits >= Math.min(2, tokens.length);
}
