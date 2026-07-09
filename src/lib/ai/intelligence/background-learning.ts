import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageArtifact } from "@/lib/types";
import { uid } from "@/lib/utils";
import { filterMemorySuggestions } from "@/lib/memory/curator";

const DISTILLABLE_QUERY =
  /\b(?:who|what|which|when|where|how much|how many|sponsors?|partners?|ceo|revenue|funding|price|score|law|regulation)\b/i;

export type BackgroundLearningInput = {
  workspaceId: string;
  roomId: string;
  topicId: string;
  employeeId: string;
  userQuestion: string;
  searchQuery: string;
  searchAnswer: string;
  messageId: string;
  agentRunId?: string;
  sourcesArtifact?: MessageArtifact;
};

export type BackgroundLearningResult = {
  queued: boolean;
  memorySuggestionKey?: string;
};

function buildDistillText(input: BackgroundLearningInput): string | null {
  const answer = input.searchAnswer.trim();
  if (!answer || answer.length < 40) return null;
  if (!DISTILLABLE_QUERY.test(input.userQuestion)) return null;
  if (
    /\b(?:I couldn't|I searched but|rather not guess|not configured)\b/i.test(answer)
  ) {
    return null;
  }

  const question = input.userQuestion.trim().slice(0, 200);
  const summary = answer.replace(/\s+/g, " ").trim().slice(0, 900);
  return `Q: ${question}\nA: ${summary}`;
}

export async function queueBackgroundLearningFromSearch(
  client: SupabaseClient,
  input: BackgroundLearningInput,
): Promise<BackgroundLearningResult> {
  const distillText = buildDistillText(input);
  if (!distillText) {
    return { queued: false };
  }

  const suggestion = filterMemorySuggestions([
    {
      text: distillText,
      reason: "Verified from a recent web search — save if this fact should persist for the team.",
    },
  ])[0];
  if (!suggestion) return { queued: false };

  const suggestionKey = uid("mem-sug");
  const artifact: MessageArtifact = {
    type: "memory_suggestion",
    id: suggestionKey,
    label: `Save to memory: ${suggestion.text.slice(0, 56)}${suggestion.text.length > 56 ? "…" : ""}`,
    meta: {
      memoryText: suggestion.text,
      reason: suggestion.reason,
      suggestionKey,
      suggestionIndex: 0,
    },
  };

  const { data: existing, error: readError } = await client
    .from("messages")
    .select("artifacts")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.messageId)
    .maybeSingle();
  if (readError) {
    console.warn("[AdeHQ background-learning] read message failed", readError.message);
    return { queued: false };
  }

  const currentArtifacts = Array.isArray(existing?.artifacts)
    ? (existing.artifacts as MessageArtifact[])
    : [];
  const hasSuggestion = currentArtifacts.some((item) => item.type === "memory_suggestion");
  if (hasSuggestion) {
    return { queued: true, memorySuggestionKey: suggestionKey };
  }

  const nextArtifacts = [...currentArtifacts, artifact];
  const { error: updateError } = await client
    .from("messages")
    .update({ artifacts: nextArtifacts })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.messageId);
  if (updateError) {
    console.warn("[AdeHQ background-learning] update message failed", updateError.message);
    return { queued: false };
  }

  return { queued: true, memorySuggestionKey: suggestionKey };
}
