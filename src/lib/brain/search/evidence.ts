import type { SearchSource } from "@/lib/ai/search/types";
import type {
  BrainSearchNeed,
  SearchCapabilityRequest,
  SearchEvidenceAssessment,
  SearchFreshness,
} from "./types";

const PRIMARY_DOMAIN_HINTS =
  /\.(gov|edu)(\.|$)|^(www\.)?(docs\.|developer\.|developers\.|api\.|help\.|support\.|blog\.|news\.|ir\.|investors\.)|wikipedia\.org|arxiv\.org|pubmed\.ncbi|sec\.gov|who\.int|oecd\.org/i;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isPrimarySource(source: SearchSource): boolean {
  const domain = domainOf(source.url);
  return Boolean(domain && PRIMARY_DOMAIN_HINTS.test(domain));
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .slice(0, 12);
}

function sourceText(source: SearchSource): string {
  return `${source.title ?? ""} ${source.snippet ?? ""}`.toLowerCase();
}

function estimateQueryCoverage(query: string, sources: SearchSource[]): number {
  const tokens = queryTokens(query);
  if (!tokens.length || !sources.length) return 0;
  const blob = sources.map(sourceText).join(" ");
  const hits = tokens.filter((t) => blob.includes(t)).length;
  return hits / tokens.length;
}

function freshnessOk(
  freshness: SearchFreshness,
  need: BrainSearchNeed,
  sources: SearchSource[],
): boolean {
  if (freshness === "stable") return true;
  if (!sources.length) return false;
  // Without reliable publishedAt from every provider, treat non-empty usable
  // results as freshness-satisfied for recent/live; evidence gate still checks coverage.
  if (need === "current_fact" && freshness === "live") {
    return sources.some((s) => Boolean(s.snippet || s.title));
  }
  return true;
}

/**
 * Decide whether retrieved sources are good enough to synthesize.
 * Does NOT fall back merely because source count is low.
 */
export function assessSearchEvidence(
  sources: SearchSource[],
  request: Pick<
    SearchCapabilityRequest,
    "query" | "need" | "freshness" | "requirePrimarySources" | "maxSources"
  >,
  options?: { answerText?: string; citedCount?: number },
): SearchEvidenceAssessment {
  const usable = sources.filter((s) => Boolean(s.url?.trim()) && Boolean(s.title?.trim() || s.snippet?.trim()));
  const primarySourceCount = usable.filter(isPrimarySource).length;
  const queryCoverage = estimateQueryCoverage(request.query, usable);
  const freshnessSatisfied = freshnessOk(request.freshness, request.need, usable);
  const citedCount = options?.citedCount ?? 0;
  const citationCoverage =
    usable.length === 0 ? 0 : Math.min(1, citedCount / Math.min(usable.length, request.maxSources ?? 6));

  let fallbackReason: string | undefined;
  let hasUsableSources = usable.length > 0;

  if (!hasUsableSources) {
    fallbackReason = "no_usable_sources";
  } else if (request.requirePrimarySources && primarySourceCount === 0) {
    hasUsableSources = false;
    fallbackReason = "primary_sources_required_unavailable";
  } else if (queryCoverage < 0.25) {
    hasUsableSources = false;
    fallbackReason = "sources_do_not_address_query";
  } else if (!freshnessSatisfied) {
    hasUsableSources = false;
    fallbackReason = "freshness_not_satisfied";
  } else if (
    options?.answerText &&
    /couldn't (verify|find)|no credible sources|unable to (confirm|verify)/i.test(options.answerText) &&
    usable.length > 0
  ) {
    // Synthesis admitted failure despite sources — allow fallback for grounded answer.
    hasUsableSources = false;
    fallbackReason = "synthesis_grounding_failed";
  }

  const confidence = hasUsableSources
    ? Math.min(
        0.98,
        0.45 + queryCoverage * 0.35 + Math.min(usable.length, 5) * 0.04 + (primarySourceCount > 0 ? 0.08 : 0),
      )
    : Math.min(0.35, queryCoverage * 0.3);

  return {
    hasUsableSources,
    sourceCount: usable.length,
    primarySourceCount,
    citationCoverage,
    freshnessSatisfied,
    queryCoverage,
    conflictingSources: false,
    confidence,
    fallbackReason,
  };
}

export function shouldFallbackFromEvidence(assessment: SearchEvidenceAssessment): boolean {
  return !assessment.hasUsableSources;
}
