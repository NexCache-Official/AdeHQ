import type { KnowledgeProvider, KnowledgeResult } from "../knowledge-provider";
import { lexicalConfidence } from "../knowledge-provider";

export const sempackProvider: KnowledgeProvider = {
  id: "sempack",
  async query(input): Promise<KnowledgeResult> {
    const chunks = input.fileContext?.chunks ?? [];
    const ranked = chunks
      .map((item) => {
        const lexical = lexicalConfidence(input.query, item.chunk.content);
        const retrievalSignal = Math.min(1, Math.max(0, item.score) / 40);
        return {
          item,
          confidence: Math.max(lexical, lexical * 0.65 + retrievalSignal * 0.35),
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    const best = ranked[0];
    if (!best || best.confidence < 0.4) {
      return {
        found: false,
        confidence: best?.confidence ?? 0,
        sources: [],
        providerId: this.id,
        reasoning: "No uploaded workspace document closely matched the request.",
      };
    }

    const top = ranked.filter((item) => item.confidence >= best.confidence - 0.1).slice(0, 3);
    return {
      found: true,
      answer: top.map(({ item }) => item.chunk.content).join("\n\n"),
      confidence: Math.min(0.98, best.confidence),
      sources: top.map(({ item }) => ({
        providerId: this.id,
        sourceType: "file" as const,
        id: item.chunk.id,
        title: item.file.displayName,
        excerpt: item.chunk.content.slice(0, 280),
        href: `/drive?file=${encodeURIComponent(item.file.id)}`,
      })),
      providerId: this.id,
      reasoning: "Matched SemPack file chunks by lexical and retrieval relevance.",
    };
  },
};
