import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageArtifact } from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";
import { filterMemorySuggestions } from "@/lib/memory/curator";
import { resolveMemoryInsert } from "@/lib/memory/dedupe";
import { inferMemoryCategory } from "@/lib/memory/categories";

const DISTILLABLE_QUERY =
  /\b(?:who|what|which|when|where|how much|how many|sponsors?|partners?|ceo|revenue|funding|price|score|law|regulation|requirements?)\b/i;

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
  searchConfidence?: number;
};

export type BackgroundLearningResult = {
  queued: boolean;
  memorySuggestionKey?: string;
  memoryId?: string;
  autoSaved?: boolean;
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

async function persistSearchDistillMemory(
  client: SupabaseClient,
  input: BackgroundLearningInput,
  distillText: string,
): Promise<string | null> {
  const category = inferMemoryCategory(distillText, "Verified from web search");
  const title = input.userQuestion.trim().slice(0, 72) || "Search fact";
  const content = distillText.replace(/^Q:[^\n]*\nA:\s*/s, "").trim() || distillText;

  const { dedupeKey, existing } = await resolveMemoryInsert(client, input.workspaceId, {
    workspaceId: input.workspaceId,
    title,
    content,
    scope: "topic",
    roomId: input.roomId,
    topicId: input.topicId,
    sourceMessageId: input.messageId,
  });

  if (existing) return existing.id;

  const memoryId = uid("mem");
  const { error } = await client.from("memory_entries").insert({
    workspace_id: input.workspaceId,
    id: memoryId,
    room_id: input.roomId,
    topic_id: input.topicId,
    type: "research",
    title,
    content,
    status: "approved",
    created_by_type: "ai",
    created_by_id: input.employeeId,
    created_by_run_id: input.agentRunId ?? null,
    dedupe_key: dedupeKey,
    category,
    scope: "topic",
    source_type: "search_distill",
    source_message_id: input.messageId,
    source_employee_id: input.employeeId,
    confidence: input.searchConfidence ?? 0.88,
    metadata: {
      learnedFromSearch: true,
      searchQuery: input.searchQuery.slice(0, 300),
      sourceAgentRunId: input.agentRunId,
      distilledAt: nowISO(),
    },
    created_at: nowISO(),
  });

  if (error) {
    console.warn("[AdeHQ background-learning] memory insert failed", error.message);
    return null;
  }

  return memoryId;
}

export async function queueBackgroundLearningFromSearch(
  client: SupabaseClient,
  input: BackgroundLearningInput,
): Promise<BackgroundLearningResult> {
  const distillText = buildDistillText(input);
  if (!distillText) {
    return { queued: false };
  }

  const confidence = input.searchConfidence ?? 0.88;
  let memoryId: string | null = null;
  let autoSaved = false;

  if (confidence >= 0.85) {
    memoryId = await persistSearchDistillMemory(client, input, distillText);
    autoSaved = Boolean(memoryId);
  }

  const suggestion = filterMemorySuggestions([
    {
      text: distillText,
      reason: autoSaved
        ? "Saved to workspace memory from this search — pin or edit in Memory if needed."
        : "Verified from a recent web search — save if this fact should persist for the team.",
    },
  ])[0];
  if (!suggestion) {
    return { queued: autoSaved, memoryId: memoryId ?? undefined, autoSaved };
  }

  if (autoSaved) {
    return { queued: true, memoryId: memoryId ?? undefined, autoSaved: true };
  }

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
    return { queued: true, memorySuggestionKey: suggestionKey, memoryId: memoryId ?? undefined, autoSaved };
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

  return {
    queued: true,
    memorySuggestionKey: suggestionKey,
    memoryId: memoryId ?? undefined,
    autoSaved,
  };
}
