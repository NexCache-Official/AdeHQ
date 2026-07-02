import type { MessageArtifact } from "@/lib/types";
import type { TopicSummaryMemorySuggestion } from "./types";

export function buildMemorySuggestionArtifacts(
  suggestions: TopicSummaryMemorySuggestion[],
): MessageArtifact[] {
  return suggestions.map((item, index) => ({
    type: "memory_suggestion" as const,
    id: `mem-sug-${index}`,
    label: `Save to memory: ${item.text.slice(0, 56)}${item.text.length > 56 ? "…" : ""}`,
    meta: {
      memoryText: item.text,
      scope: item.scope,
      reason: item.reason,
      suggestionIndex: index,
    },
  }));
}

export function filterDmMessageArtifacts(artifacts: MessageArtifact[]): MessageArtifact[] {
  return artifacts.filter((artifact) => artifact.type !== "work_log");
}
