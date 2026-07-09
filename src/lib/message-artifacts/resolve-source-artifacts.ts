import type { MessageArtifact } from "@/lib/types";

export type ResolvedWebSource = {
  id: string;
  title: string;
  url: string;
  domain?: string;
  confidence?: "high" | "medium" | "low";
};

export type ResolvedKnowledgeSource = {
  id: string;
  label: string;
  providerId?: string;
  memoryId?: string;
  fileId?: string;
  chunkId?: string;
  quote?: string;
  locator?: string;
  href?: string;
};

export function resolveWebSources(artifact: MessageArtifact): ResolvedWebSource[] {
  if (artifact.type === "web_sources") {
    return artifact.meta?.webSources ?? [];
  }
  if (artifact.type === "search_sources") {
    return (artifact.meta?.searchSources ?? []).map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      domain: source.domain,
      confidence: source.confidence,
    }));
  }
  return [];
}

export function resolveKnowledgeSources(
  artifact: MessageArtifact,
): ResolvedKnowledgeSource[] {
  if (artifact.type === "knowledge_sources") {
    return artifact.meta?.knowledgeSources ?? [];
  }
  if (artifact.type === "file" && artifact.meta?.chunkId) {
    return [
      {
        id: artifact.id,
        label: artifact.label,
        fileId: artifact.meta.fileId,
        chunkId: artifact.meta.chunkId,
        quote: artifact.meta.quote,
        locator: artifact.meta.locator,
      },
    ];
  }
  return [];
}

export function isWebSourceArtifact(artifact: MessageArtifact): boolean {
  return artifact.type === "web_sources" || artifact.type === "search_sources";
}

export function isKnowledgeSourceArtifact(artifact: MessageArtifact): boolean {
  return artifact.type === "knowledge_sources";
}
