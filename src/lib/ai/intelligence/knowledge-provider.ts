import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryEntry } from "@/lib/types";
import type { FileContextBundle } from "@/lib/server/file-context";
import type { KnowledgeSource } from "./intelligence-context";

export type KnowledgeQuery = {
  workspaceId: string;
  roomId: string;
  topicId: string;
  query: string;
  recency?: "any" | "year" | "month";
  memoryEntries?: MemoryEntry[];
  topicSummary?: string | null;
  fileContext?: FileContextBundle;
};

export type KnowledgeResult = {
  found: boolean;
  answer?: string;
  confidence: number;
  sources: KnowledgeSource[];
  providerId: string;
  reasoning: string;
};

export interface KnowledgeProvider {
  id: string;
  query(
    input: KnowledgeQuery,
    client: SupabaseClient,
  ): Promise<KnowledgeResult>;
}

export type KnowledgeOrchestratorResult = KnowledgeResult & {
  candidates: KnowledgeResult[];
};

export async function queryKnowledgeProviders(
  providers: KnowledgeProvider[],
  input: KnowledgeQuery,
  client: SupabaseClient,
): Promise<KnowledgeOrchestratorResult> {
  const settled = await Promise.allSettled(
    providers.map((provider) => provider.query(input, client)),
  );
  const candidates = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    console.warn(
      `[AdeHQ intelligence] knowledge provider ${providers[index]?.id ?? index} failed`,
      result.reason,
    );
    return [];
  });
  const best = candidates
    .filter((candidate) => candidate.found)
    .sort((a, b) => b.confidence - a.confidence)[0];

  return {
    ...(best ?? {
      found: false,
      confidence: 0,
      sources: [],
      providerId: "none",
      reasoning: "No knowledge provider found a relevant answer.",
    }),
    candidates,
  };
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "at", "is",
  "are", "was", "were", "what", "who", "which", "how", "when", "where", "me",
  "our", "we", "you", "this", "that", "it", "with", "from",
]);

export function knowledgeTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((term) => term.length > 2 && !STOPWORDS.has(term)),
    ),
  ];
}

export function lexicalConfidence(query: string, candidate: string): number {
  const queryTerms = knowledgeTerms(query);
  if (!queryTerms.length) return 0;
  const candidateTerms = new Set(knowledgeTerms(candidate));
  const matched = queryTerms.filter((term) => candidateTerms.has(term)).length;
  const coverage = matched / queryTerms.length;
  return Math.max(0, Math.min(1, coverage));
}
