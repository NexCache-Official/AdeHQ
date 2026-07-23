import { uid } from "@/lib/utils";
import type { SearchNeed, SearchSource } from "./types";

export type SearchSourceType =
  | "official"
  | "business_press"
  | "data_provider"
  | "seo_blog"
  | "social"
  | "unknown";

export type SearchSourceConfidence = "high" | "medium" | "low";

export type SearchSourceCard = {
  id: string;
  title: string;
  url: string;
  domain: string;
  publishedAt?: string;
  snippet?: string;
  sourceType: SearchSourceType;
  confidence: SearchSourceConfidence;
  usedInAnswer: boolean;
  excludedReason?: string;
};

export type NormalizedSearchSources = {
  used: SearchSourceCard[];
  excluded: SearchSourceCard[];
  sourceCount: number;
  usedSourceCount: number;
  excludedSourceCount: number;
};

const DATA_PROVIDER_DOMAINS = [
  "sacra.co",
  "getlatka.com",
  "crunchbase.com",
  "pitchbook.com",
  "cbinsights.com",
];

const BUSINESS_PRESS_DOMAINS = [
  "bloomberg.com",
  "reuters.com",
  "techcrunch.com",
  "theinformation.com",
  "businessinsider.com",
  "ft.com",
  "wsj.com",
  "forbes.com",
  "cnbc.com",
];

const SEO_BLOG_HINTS = [
  "statistics",
  "usage statistics",
  "revenue and usage",
  "market share",
  "demand sage",
  "statista",
];

const SOCIAL_DOMAINS = ["linkedin.com", "twitter.com", "x.com", "facebook.com"];

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function extractCompanyHint(query: string): string | null {
  const possessive = query.match(/\b([A-Za-z][A-Za-z0-9.-]{1,40})'s\b/);
  if (possessive) return possessive[1].toLowerCase();

  const ofMatch = query.match(/\b(?:revenue|funding|valuation|ceo|founder)\s+of\s+([A-Za-z][A-Za-z0-9.-]{1,40})\b/i);
  if (ofMatch) return ofMatch[1].toLowerCase();

  return null;
}

export function classifySourceType(
  domain: string,
  title: string,
  snippet?: string,
): SearchSourceType {
  const haystack = `${domain} ${title} ${snippet ?? ""}`.toLowerCase();

  if (SOCIAL_DOMAINS.some((d) => domain.endsWith(d))) return "social";

  if (DATA_PROVIDER_DOMAINS.some((d) => domain.endsWith(d))) return "data_provider";

  if (BUSINESS_PRESS_DOMAINS.some((d) => domain.endsWith(d))) return "business_press";

  if (SEO_BLOG_HINTS.some((hint) => haystack.includes(hint))) return "seo_blog";

  if (/\b(blog|press|newsroom)\b/.test(haystack) && !SEO_BLOG_HINTS.some((h) => haystack.includes(h))) {
    return "official";
  }

  return "unknown";
}

function confidenceForType(sourceType: SearchSourceType): SearchSourceConfidence {
  if (sourceType === "official" || sourceType === "business_press" || sourceType === "data_provider") {
    return "high";
  }
  if (sourceType === "unknown") return "medium";
  return "low";
}

function sourceRankScore(source: SearchSourceCard): number {
  const typeScore: Record<SearchSourceType, number> = {
    official: 100,
    business_press: 90,
    data_provider: 85,
    unknown: 50,
    seo_blog: 35,
    social: 20,
  };
  const confidenceScore = source.confidence === "high" ? 10 : source.confidence === "medium" ? 5 : 0;
  return typeScore[source.sourceType] + confidenceScore;
}

export function rankSearchSources(sources: SearchSourceCard[]): SearchSourceCard[] {
  return [...sources].sort((a, b) => sourceRankScore(b) - sourceRankScore(a));
}

export function isUnrelatedSource(
  query: string,
  source: Pick<SearchSourceCard, "title" | "url" | "snippet" | "domain">,
): string | null {
  const companyHint = extractCompanyHint(query);
  const haystack = `${source.title} ${source.snippet ?? ""} ${source.url}`.toLowerCase();

  if (/\b(PPLX|ticker|stock price|share price|Q[1-4]\s+\d{4}\s+revenue guidance)\b/i.test(haystack)) {
    if (!companyHint || !haystack.includes(companyHint)) {
      return "Unrelated ticker/stock guidance source.";
    }
  }

  if (source.domain.endsWith("x.com") || source.domain.endsWith("twitter.com")) {
    if (/\b(finance|ticker|stock|guidance)\b/i.test(haystack)) {
      return "Social post appears unrelated to the company fact question.";
    }
  }

  if (companyHint) {
    const companyTokens = companyHint.split(/\s+/).filter(Boolean);
    const mentionsCompany = companyTokens.some((token) => haystack.includes(token));
    const looksLikeDifferentEntity =
      /\b(apple|microsoft|google|amazon|meta|nvidia|openai)\b/i.test(haystack) &&
      !companyTokens.some((token) => haystack.includes(token));
    if (!mentionsCompany && looksLikeDifferentEntity) {
      return "Source appears to reference a different company.";
    }
  }

  return null;
}

function dedupeSources(sources: SearchSource[]): SearchSource[] {
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const source of sources) {
    const url = source.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(source);
  }
  return out;
}

export function normalizeGatewaySearchSources(
  rawSources: SearchSource[],
  query: string,
  options?: { maxUsed?: number; searchNeed?: SearchNeed },
): NormalizedSearchSources {
  const maxUsed = options?.maxUsed ?? 5;
  const cards: SearchSourceCard[] = dedupeSources(rawSources).map((source) => {
    const domain = extractDomain(source.url);
    const sourceType = classifySourceType(domain, source.title, source.snippet);
    return {
      id: uid("src"),
      title: source.title.trim() || domain || "Source",
      url: source.url.trim(),
      domain,
      snippet: source.snippet?.trim(),
      sourceType,
      confidence: confidenceForType(sourceType),
      usedInAnswer: false,
    };
  });

  const { used, excluded } = filterLowQualitySources(cards, query);
  const ranked = rankSearchSources(used);
  const selected = ranked.slice(0, maxUsed).map((source) => ({ ...source, usedInAnswer: true }));
  const overflow = ranked.slice(maxUsed).map((source) => ({
    ...source,
    usedInAnswer: false,
    excludedReason: "Lower-ranked source omitted from answer.",
  }));

  return {
    used: selected,
    excluded: [...excluded, ...overflow],
    sourceCount: cards.length,
    usedSourceCount: selected.length,
    excludedSourceCount: excluded.length + overflow.length,
  };
}

export function filterLowQualitySources(
  sources: SearchSourceCard[],
  query: string,
): { used: SearchSourceCard[]; excluded: SearchSourceCard[] } {
  const used: SearchSourceCard[] = [];
  const excluded: SearchSourceCard[] = [];

  for (const source of sources) {
    const unrelated = isUnrelatedSource(query, source);
    if (unrelated) {
      excluded.push({ ...source, usedInAnswer: false, excludedReason: unrelated });
      continue;
    }
    used.push(source);
  }

  return { used, excluded };
}

/**
 * Align the inline `[n]` citation markers in a synthesized answer with the
 * sources that will actually be displayed.
 *
 * The synthesis model numbers `[1]..[N]` against the full provider source list
 * (in `rawSources` order). But `normalizeGatewaySearchSources` reranks and slices
 * to the top-quality subset, so the stored numbering no longer matches, and any
 * source cited beyond the cutoff (e.g. `[6]`, `[7]`) becomes invisible.
 *
 * This rebuilds a single ordered display list — ranked `used` sources first, then
 * any lower-ranked source that the answer actually cites — and renumbers the
 * markers in the text to match. Every `[n]` in the returned text resolves to
 * `sources[n-1]`; markers whose source cannot be resolved are dropped.
 */
export function realignSearchCitations(params: {
  text: string;
  rawSources: SearchSource[];
  normalized: NormalizedSearchSources;
}): { text: string; sources: SearchSourceCard[] } {
  const { text, rawSources, normalized } = params;
  const markerPattern = /\[(\d{1,3})\]/g;

  const cardByUrl = new Map<string, SearchSourceCard>();
  for (const card of [...normalized.used, ...normalized.excluded]) {
    const key = card.url.trim();
    if (key && !cardByUrl.has(key)) cardByUrl.set(key, card);
  }

  const citedRawNumbers: number[] = [];
  const seenRaw = new Set<number>();
  for (const match of text.matchAll(markerPattern)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= rawSources.length && !seenRaw.has(n)) {
      seenRaw.add(n);
      citedRawNumbers.push(n);
    }
  }

  const ordered: SearchSourceCard[] = [];
  const includedUrls = new Set<string>();
  const pushCard = (card: SearchSourceCard | undefined) => {
    if (!card) return;
    const key = card.url.trim();
    if (!key || includedUrls.has(key)) return;
    includedUrls.add(key);
    ordered.push(card);
  };

  for (const card of normalized.used) pushCard(card);
  for (const n of [...citedRawNumbers].sort((a, b) => a - b)) {
    const url = rawSources[n - 1]?.url?.trim();
    if (url) pushCard(cardByUrl.get(url));
  }

  const finalNumberByUrl = new Map<string, number>();
  ordered.forEach((card, index) => finalNumberByUrl.set(card.url.trim(), index + 1));

  const rewritten = text
    .replace(markerPattern, (_whole, digits: string) => {
      const url = rawSources[Number(digits) - 1]?.url?.trim();
      const finalNumber = url ? finalNumberByUrl.get(url) : undefined;
      return finalNumber ? `[${finalNumber}]` : "";
    })
    // Tidy spacing left behind when a marker was dropped or collapsed.
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/\[(\d+)\]\s*(?=\[\1\])/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { text: rewritten, sources: ordered };
}

/**
 * Rebuild a cached/session search answer so its inline markers and Sources
 * artifact share exactly the same ordering. Replay previously re-ranked the
 * sources to five cards while leaving the stored answer's [n] markers intact.
 */
export function finalizeReplayedSearchPresentation(input: {
  answer: string;
  sources: SearchSource[];
  query: string;
  searchNeed?: SearchNeed;
}): {
  answer: string;
  sources: SearchSource[];
  artifact?: import("@/lib/types").MessageArtifact;
} {
  const normalized = normalizeGatewaySearchSources(input.sources, input.query, {
    maxUsed: 5,
    searchNeed: input.searchNeed,
  });
  const aligned = realignSearchCitations({
    text: stripInlineSourcesSection(input.answer),
    rawSources: input.sources,
    normalized,
  });
  const sources = aligned.sources.map((source) => ({
    title: source.title,
    url: source.url,
    snippet: source.snippet,
  }));
  const artifact =
    aligned.sources.length > 0
      ? buildWebSourcesArtifactFromCards(aligned.sources, {
          sourceCount: normalized.sourceCount,
          excludedSourceCount: Math.max(0, normalized.sourceCount - aligned.sources.length),
        })
      : undefined;
  return { answer: aligned.text, sources, artifact };
}

/** Remove inline Sources section — cards render separately. */
export function stripInlineSourcesSection(text: string): string {
  return text
    .replace(/\n+\*\*Sources\*\*[\s\S]*$/i, "")
    .replace(/\n+Sources[\s\S]*$/i, "")
    .trim();
}

export function isPrivateCompanyFactQuery(query: string, need?: SearchNeed): boolean {
  if (need === "company_fact") return true;
  return /\b(revenue|arr|funding|valuation|raised|run[- ]rate)\b/i.test(query);
}

export function ensurePrivateCompanyWording(answer: string, query: string, need?: SearchNeed): string {
  if (!isPrivateCompanyFactQuery(query, need)) return answer;
  const lower = answer.toLowerCase();
  const hasCaution =
    lower.includes("private") ||
    lower.includes("estimated") ||
    lower.includes("reported") ||
    lower.includes("arr") ||
    lower.includes("run-rate") ||
    lower.includes("run rate") ||
    lower.includes("audited");
  if (hasCaution) return answer;
  return `${answer.trim()}\n\nNote: For private companies, treat figures as reported or estimated unless an audited filing is cited.`;
}

export function buildSearchSourcesArtifact(
  normalized: NormalizedSearchSources,
): import("@/lib/types").MessageArtifact {
  return {
    type: "search_sources",
    id: uid("srcset"),
    label: "Sources",
    meta: {
      sourceCount: normalized.sourceCount,
      usedSourceCount: normalized.usedSourceCount,
      excludedSourceCount: normalized.excludedSourceCount,
      searchSources: normalized.used.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        domain: source.domain,
        snippet: source.snippet,
        sourceType: source.sourceType,
        confidence: source.confidence,
        publishedAt: source.publishedAt,
      })),
    },
  };
}

export function buildWebSourcesArtifact(
  normalized: NormalizedSearchSources,
): import("@/lib/types").MessageArtifact {
  return {
    type: "web_sources",
    id: uid("web"),
    label: "Sources",
    meta: {
      sourceCount: normalized.sourceCount,
      usedSourceCount: normalized.usedSourceCount,
      excludedSourceCount: normalized.excludedSourceCount,
      webSources: normalized.used.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        domain: source.domain,
        confidence: source.confidence,
      })),
    },
  };
}

/**
 * Build a web_sources artifact from an explicit ordered card list so its order
 * (and therefore the `[n]` chip numbering) matches the realigned answer text.
 */
export function buildWebSourcesArtifactFromCards(
  cards: SearchSourceCard[],
  counts: { sourceCount: number; excludedSourceCount: number },
): import("@/lib/types").MessageArtifact {
  return {
    type: "web_sources",
    id: uid("web"),
    label: "Sources",
    meta: {
      sourceCount: counts.sourceCount,
      usedSourceCount: cards.length,
      excludedSourceCount: counts.excludedSourceCount,
      webSources: cards.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        domain: source.domain,
        confidence: source.confidence,
      })),
    },
  };
}

export function buildKnowledgeSourcesArtifact(input: {
  sources: Array<{
    id: string;
    label: string;
    providerId?: string;
    memoryId?: string;
    fileId?: string;
    chunkId?: string;
    quote?: string;
    locator?: string;
    href?: string;
  }>;
  confidence?: number;
  providerId?: string;
}): import("@/lib/types").MessageArtifact {
  return {
    type: "knowledge_sources",
    id: uid("know"),
    label: "From project knowledge",
    meta: {
      knowledgeSources: input.sources,
      knowledgeConfidence: input.confidence,
      providerId: input.providerId,
    },
  };
}
