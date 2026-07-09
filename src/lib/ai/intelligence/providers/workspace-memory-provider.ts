import type { KnowledgeProvider, KnowledgeResult } from "../knowledge-provider";
import { lexicalConfidence } from "../knowledge-provider";

const CURRENT_FACT =
  /\b(today|current|latest|recent|this year|this month|price|score|schedule|ceo|funding|revenue)\b/i;

function recencyMultiplier(query: string, createdAt: string): number {
  if (!CURRENT_FACT.test(query)) return 1;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageHours = ageMs / (60 * 60 * 1000);
  if (ageHours <= 24) return 1;
  if (ageHours <= 24 * 7) return 0.82;
  if (ageHours <= 24 * 30) return 0.65;
  return 0.45;
}

export const workspaceMemoryProvider: KnowledgeProvider = {
  id: "workspace_memory",
  async query(input): Promise<KnowledgeResult> {
    const eligible = (input.memoryEntries ?? []).filter(
      (entry) =>
        entry.status === "approved" ||
        entry.status === "pinned" ||
        entry.metadata?.learnedFromSearch === true,
    );
    const ranked = eligible
      .map((entry) => {
        const lexical = lexicalConfidence(
          input.query,
          `${entry.title}\n${entry.content}\n${entry.tags?.join(" ") ?? ""}`,
        );
        const sourceConfidence = entry.confidence ?? 0.85;
        const confidence =
          lexical *
          sourceConfidence *
          recencyMultiplier(input.query, entry.updatedAt ?? entry.createdAt);
        return { entry, confidence };
      })
      .sort((a, b) => b.confidence - a.confidence);

    const best = ranked[0];
    const summaryConfidence = input.topicSummary
      ? lexicalConfidence(input.query, input.topicSummary) * 0.82
      : 0;
    if ((!best || summaryConfidence > best.confidence) && input.topicSummary && summaryConfidence >= 0.35) {
      return {
        found: true,
        answer: input.topicSummary,
        confidence: Math.min(0.88, summaryConfidence),
        sources: [
          {
            providerId: this.id,
            sourceType: "topic_summary",
            id: input.topicId,
            title: "Topic summary",
            excerpt: input.topicSummary.slice(0, 280),
          },
        ],
        providerId: this.id,
        reasoning: "Matched the current topic summary.",
      };
    }
    if (!best || best.confidence < 0.35) {
      return {
        found: false,
        confidence: best?.confidence ?? 0,
        sources: [],
        providerId: this.id,
        reasoning: "No approved workspace memory closely matched the request.",
      };
    }

    return {
      found: true,
      answer: best.entry.content,
      confidence: Math.min(0.99, best.confidence),
      sources: [
        {
          providerId: this.id,
          sourceType:
            best.entry.metadata?.learnedFromSearch === true
              ? "search_distill"
              : "memory",
          id: best.entry.id,
          title: best.entry.title,
          excerpt: best.entry.content.slice(0, 280),
          href: `/memory?entry=${encodeURIComponent(best.entry.id)}`,
        },
      ],
      providerId: this.id,
      reasoning: "Matched approved workspace memory by relevance and recency.",
    };
  },
};
