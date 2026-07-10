import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageArtifact } from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";
import { getResearchSessionTtlDays } from "./config";
import type { SearchAnswerResult, SearchRoute } from "./types";
import { buildWebSourcesArtifact, normalizeGatewaySearchSources } from "./source-normalizer";
import { stripFillerWords } from "./search-cache";

export type ResearchSessionReuse = {
  sessionId: string;
  answer: string;
  sources: SearchAnswerResult["sources"];
  route: SearchRoute;
  providerRoute: SearchAnswerResult["providerRoute"];
  webSourcesArtifact?: MessageArtifact;
  searchSourcesArtifact?: MessageArtifact;
  confidence?: number;
};

type SessionRow = {
  id: string;
  title: string;
};

type SessionEventRow = {
  query: string | null;
  answer: string | null;
  sources: SearchAnswerResult["sources"] | null;
  provider: string | null;
  provider_route: string | null;
  confidence: number | null;
};

function sessionTitleFromQuery(query: string): string {
  const trimmed = query.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function queryTokens(query: string): Set<string> {
  const compact = stripFillerWords(query.toLowerCase());
  return new Set(
    compact
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

function queriesOverlap(a: string, b: string): boolean {
  const tokensA = queryTokens(a);
  const tokensB = queryTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  const minSize = Math.min(tokensA.size, tokensB.size);
  return overlap >= Math.max(2, Math.ceil(minSize * 0.5));
}

async function findActiveSession(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<SessionRow | null> {
  const { data, error } = await client
    .from("research_sessions")
    .select("id, title")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .eq("status", "active")
    .gt("expires_at", nowISO())
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[AdeHQ research-session] lookup failed", error.message);
    return null;
  }
  return data as SessionRow | null;
}

async function ensureActiveSession(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    topicId: string;
    employeeId: string;
    agentRunId?: string;
    query: string;
  },
): Promise<string> {
  const existing = await findActiveSession(client, input.workspaceId, input.topicId);
  if (existing) return existing.id;

  const sessionId = uid("rs");
  const expiresAt = new Date(
    Date.now() + getResearchSessionTtlDays() * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error } = await client.from("research_sessions").insert({
    id: sessionId,
    workspace_id: input.workspaceId,
    topic_id: input.topicId,
    title: sessionTitleFromQuery(input.query),
    status: "active",
    lead_employee_id: input.employeeId,
    created_by_run_id: input.agentRunId ?? null,
    expires_at: expiresAt,
    created_at: nowISO(),
    updated_at: nowISO(),
  });

  if (error) {
    console.warn("[AdeHQ research-session] create failed", error.message);
    return sessionId;
  }
  return sessionId;
}

export async function getReusableSessionFindings(
  client: SupabaseClient,
  input: { workspaceId: string; topicId: string; query: string },
): Promise<ResearchSessionReuse | null> {
  const session = await findActiveSession(client, input.workspaceId, input.topicId);
  if (!session) return null;

  const { data, error } = await client
    .from("research_session_events")
    .select("query, answer, sources, provider, provider_route, confidence")
    .eq("session_id", session.id)
    .eq("event_type", "search")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !data?.length) return null;

  for (const row of data as SessionEventRow[]) {
    if (!row.answer?.trim() || !row.query) continue;
    if (!queriesOverlap(input.query, row.query)) continue;

    const sources = Array.isArray(row.sources) ? row.sources : [];
    const normalized = normalizeGatewaySearchSources(sources, row.query, { maxUsed: 5 });
    const artifact =
      normalized.usedSourceCount > 0 ? buildWebSourcesArtifact(normalized) : undefined;

    return {
      sessionId: session.id,
      answer: row.answer,
      sources,
      route: (row.provider as SearchRoute) ?? "gateway_perplexity",
      providerRoute: (row.provider_route as SearchAnswerResult["providerRoute"]) ?? "vercel_gateway",
      webSourcesArtifact: artifact,
      searchSourcesArtifact: artifact,
      confidence: row.confidence ?? undefined,
    };
  }

  return null;
}

export async function recordSessionSearchEvent(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    topicId: string;
    employeeId: string;
    agentRunId?: string;
    query: string;
    answer: string;
    sources: SearchAnswerResult["sources"];
    route: SearchRoute;
    providerRoute: SearchAnswerResult["providerRoute"];
    confidence?: number;
    webSourcesArtifact?: MessageArtifact;
  },
): Promise<string | undefined> {
  const sessionId = await ensureActiveSession(client, input);
  const eventId = uid("rse");

  const { error } = await client.from("research_session_events").insert({
    id: eventId,
    session_id: sessionId,
    event_type: "search",
    query: input.query.trim().slice(0, 2000),
    answer: input.answer.trim().slice(0, 8000),
    sources: input.sources ?? [],
    provider: input.route,
    provider_route: input.providerRoute,
    confidence: input.confidence ?? null,
    agent_run_id: input.agentRunId ?? null,
    created_at: nowISO(),
  });

  if (error) {
    console.warn("[AdeHQ research-session] event insert failed", error.message);
    return undefined;
  }

  await client
    .from("research_sessions")
    .update({ updated_at: nowISO() })
    .eq("id", sessionId);

  return sessionId;
}
