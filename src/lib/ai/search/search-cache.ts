import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchAnswerResult, SearchRoute } from "./types";
import type { MessageArtifact } from "@/lib/types";
import {
  finalizeReplayedSearchPresentation,
  type NormalizedSearchSources,
} from "./source-normalizer";
import { nowISO } from "@/lib/utils";

export type CachedSearchAnswer = {
  cacheKey: string;
  query: string;
  answer: string;
  sources: SearchAnswerResult["sources"];
  route: SearchRoute;
  providerRoute: SearchAnswerResult["providerRoute"];
  searchMeta?: SearchAnswerResult["searchMeta"];
  webSourcesArtifact?: MessageArtifact;
  searchSourcesArtifact?: MessageArtifact;
  hitCount: number;
  confidence?: number;
};

const DEFAULT_TTL_HOURS = 24;
/** Live / breaking — 20 minutes. */
const LIVE_TTL_HOURS = 20 / 60;
/** News / current events — 45 minutes. */
const NEWS_TTL_HOURS = 45 / 60;
/** Company funding/revenue/leadership — 12 hours. */
const COMPANY_TTL_HOURS = 12;
/** Market research — 18 hours. */
const MARKET_TTL_HOURS = 18;
/** Technical documentation — 48 hours. */
const DOCS_TTL_HOURS = 48;
/** Academic / stable reference — 5 days. */
const ACADEMIC_TTL_HOURS = 24 * 5;
const FAST_FACT_TTL_HOURS = 6;
const STABLE_FACT_TTL_HOURS = 72;

const FILLER_WORDS =
  /\b(what|was|is|are|the|a|an|how|much|many|please|tell|me|about|in|for|of|did|does|do|can|you|find|search|look up)\b/gi;

export function stripFillerWords(query: string): string {
  return query
    .replace(FILLER_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeSearchConfidence(
  normalized: Pick<NormalizedSearchSources, "usedSourceCount" | "sourceCount">,
): number {
  if (normalized.usedSourceCount <= 0) return 0;
  const base = 0.65 + Math.min(normalized.usedSourceCount, 5) * 0.06;
  return Math.min(0.98, base);
}

/** PR-14 need-aware TTLs (workspace-scoped cache only). */
export function ttlHoursForSearchNeed(need?: string | null): number {
  switch (need) {
    case "news":
    case "current_fact":
      return NEWS_TTL_HOURS;
    case "company_fact":
    case "company_research":
      return COMPANY_TTL_HOURS;
    case "market_research":
    case "people_research":
      return MARKET_TTL_HOURS;
    case "technical_docs":
      return DOCS_TTL_HOURS;
    case "academic_research":
    case "source_verification":
      return ACADEMIC_TTL_HOURS;
    default:
      return DEFAULT_TTL_HOURS;
  }
}

function ttlHoursForQuery(query: string, need?: string | null): number {
  if (
    /\b(?:today|tonight|score|live|breaking|just announced)\b/i.test(query)
  ) {
    return LIVE_TTL_HOURS;
  }
  if (need) return ttlHoursForSearchNeed(need);
  if (/\b(?:this week|headlines?|news)\b/i.test(query)) {
    return NEWS_TTL_HOURS;
  }
  if (/\b(?:funding|revenue|ceo|valuation|raised)\b/i.test(query)) {
    return COMPANY_TTL_HOURS;
  }
  if (/\b(?:docs?|documentation|api reference)\b/i.test(query)) {
    return DOCS_TTL_HOURS;
  }
  if (/\b(?:arxiv|paper|academic)\b/i.test(query)) {
    return ACADEMIC_TTL_HOURS;
  }
  if (/\b(?:law|regulation|visa|tax|definition|history)\b/i.test(query)) {
    return STABLE_FACT_TTL_HOURS;
  }
  if (/\b(?:today|tonight|score|live|breaking|just announced|this week)\b/i.test(query)) {
    return FAST_FACT_TTL_HOURS;
  }
  return DEFAULT_TTL_HOURS;
}

function hashNormalizedQuery(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex").slice(0, 40);
}

export function normalizeSearchCacheKey(query: string): string {
  const normalized = query
    .toLowerCase()
    .replace(/\bthis year's\b/g, new Date().getUTCFullYear().toString())
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return hashNormalizedQuery(normalized);
}

/** Try primary and compact (filler-stripped) cache keys for cross-phrasing hits. */
export function normalizeSearchCacheKeys(query: string): string[] {
  const primary = normalizeSearchCacheKey(query);
  const compact = normalizeSearchCacheKey(stripFillerWords(query));
  return [...new Set([primary, compact].filter(Boolean))];
}

type CacheRow = {
  cache_key: string;
  query: string;
  answer: string;
  sources: SearchAnswerResult["sources"];
  route: SearchRoute;
  provider_route: SearchAnswerResult["providerRoute"];
  search_meta: SearchAnswerResult["searchMeta"] | null;
  hit_count: number;
};

function rowToCachedAnswer(row: CacheRow): CachedSearchAnswer {
  const sources = Array.isArray(row.sources) ? row.sources : [];
  const presentation = finalizeReplayedSearchPresentation({
    answer: row.answer,
    sources,
    query: row.query,
    searchNeed: row.search_meta?.searchNeed,
  });
  return {
    cacheKey: row.cache_key,
    query: row.query,
    answer: presentation.answer,
    sources: presentation.sources,
    route: row.route,
    providerRoute: row.provider_route,
    searchMeta: row.search_meta ?? undefined,
    searchSourcesArtifact: presentation.artifact,
    webSourcesArtifact: presentation.artifact,
    hitCount: row.hit_count,
    confidence: row.search_meta?.confidence,
  };
}

export async function getSearchCache(
  client: SupabaseClient,
  workspaceId: string,
  query: string,
): Promise<CachedSearchAnswer | null> {
  const cacheKeys = normalizeSearchCacheKeys(query);

  for (const cacheKey of cacheKeys) {
    const { data, error } = await client
      .from("workspace_search_cache")
      .select(
        "cache_key, query, answer, sources, route, provider_route, search_meta, hit_count",
      )
      .eq("workspace_id", workspaceId)
      .eq("cache_key", cacheKey)
      .gt("expires_at", nowISO())
      .maybeSingle();

    if (error) {
      console.warn("[AdeHQ search-cache] lookup failed", error.message);
      continue;
    }
    if (!data) continue;

    await client
      .from("workspace_search_cache")
      .update({
        hit_count: (data.hit_count ?? 0) + 1,
        updated_at: nowISO(),
      })
      .eq("workspace_id", workspaceId)
      .eq("cache_key", cacheKey);

    return rowToCachedAnswer(data as CacheRow);
  }

  return null;
}

export async function setSearchCache(
  client: SupabaseClient,
  workspaceId: string,
  query: string,
  result: Pick<
    SearchAnswerResult,
    | "answer"
    | "sources"
    | "route"
    | "providerRoute"
    | "searchMeta"
    | "searchSourcesArtifact"
    | "webSourcesArtifact"
  >,
  options?: {
    topicId?: string;
    sourceAgentRunId?: string;
    confidence?: number;
    searchNeed?: string;
  },
): Promise<string> {
  const cacheKey = normalizeSearchCacheKey(query);
  const need = options?.searchNeed ?? result.searchMeta?.searchNeed ?? null;
  const expiresAt = new Date(
    Date.now() + ttlHoursForQuery(query, need) * 60 * 60 * 1000,
  ).toISOString();

  const searchMeta = {
    ...(result.searchMeta ?? {}),
    ...(options?.confidence != null ? { confidence: options.confidence } : {}),
    ...(need ? { searchNeed: need } : {}),
  };

  const { error } = await client.from("workspace_search_cache").upsert(
    {
      workspace_id: workspaceId,
      cache_key: cacheKey,
      query: query.trim().slice(0, 2000),
      answer: result.answer,
      sources: result.sources ?? [],
      route: result.route,
      provider_route: result.providerRoute,
      search_meta: searchMeta,
      hit_count: 0,
      topic_id: options?.topicId ?? null,
      source_agent_run_id: options?.sourceAgentRunId ?? null,
      expires_at: expiresAt,
      updated_at: nowISO(),
    },
    { onConflict: "workspace_id,cache_key" },
  );

  if (error) {
    console.warn("[AdeHQ search-cache] store failed", error.message);
  }
  return cacheKey;
}

export function cachedAnswerToSearchResult(
  cached: CachedSearchAnswer,
): SearchAnswerResult {
  return {
    answer: cached.answer,
    sources: cached.sources,
    route: cached.route,
    providerRoute: cached.providerRoute,
    estimatedCostUsd: 0,
    estimatedWorkMinutes: 0,
    searchMeta: cached.searchMeta,
    webSourcesArtifact: cached.webSourcesArtifact ?? cached.searchSourcesArtifact,
    searchSourcesArtifact: cached.searchSourcesArtifact ?? cached.webSourcesArtifact,
    fromCache: true,
    cacheKey: cached.cacheKey,
  };
}
