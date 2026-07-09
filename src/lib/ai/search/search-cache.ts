import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchAnswerResult, SearchRoute } from "./types";
import type { MessageArtifact } from "@/lib/types";
import {
  buildWebSourcesArtifact,
  normalizeGatewaySearchSources,
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
};

const DEFAULT_TTL_HOURS = 24;
const FAST_FACT_TTL_HOURS = 6;
const STABLE_FACT_TTL_HOURS = 72;

function ttlHoursForQuery(query: string): number {
  if (
    /\b(?:today|tonight|score|live|breaking|just announced|this week)\b/i.test(query)
  ) {
    return FAST_FACT_TTL_HOURS;
  }
  if (/\b(?:law|regulation|visa|tax|definition|history)\b/i.test(query)) {
    return STABLE_FACT_TTL_HOURS;
  }
  return DEFAULT_TTL_HOURS;
}

export function normalizeSearchCacheKey(query: string): string {
  const normalized = query
    .toLowerCase()
    .replace(/\bthis year's\b/g, new Date().getUTCFullYear().toString())
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 40);
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
  const normalized = normalizeGatewaySearchSources(sources, row.query, {
    maxUsed: 5,
  });
  const artifact =
    normalized.usedSourceCount > 0 ? buildWebSourcesArtifact(normalized) : undefined;
  return {
    cacheKey: row.cache_key,
    query: row.query,
    answer: row.answer,
    sources,
    route: row.route,
    providerRoute: row.provider_route,
    searchMeta: row.search_meta ?? undefined,
    searchSourcesArtifact: artifact,
    webSourcesArtifact: artifact,
    hitCount: row.hit_count,
  };
}

export async function getSearchCache(
  client: SupabaseClient,
  workspaceId: string,
  query: string,
): Promise<CachedSearchAnswer | null> {
  const cacheKey = normalizeSearchCacheKey(query);
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
    return null;
  }
  if (!data) return null;

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
  >,
): Promise<string> {
  const cacheKey = normalizeSearchCacheKey(query);
  const expiresAt = new Date(
    Date.now() + ttlHoursForQuery(query) * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await client.from("workspace_search_cache").upsert(
    {
      workspace_id: workspaceId,
      cache_key: cacheKey,
      query: query.trim().slice(0, 2000),
      answer: result.answer,
      sources: result.sources ?? [],
      route: result.route,
      provider_route: result.providerRoute,
      search_meta: result.searchMeta ?? {},
      hit_count: 0,
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
