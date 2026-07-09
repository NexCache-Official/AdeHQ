import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeReplyForChat } from "@/lib/ai/normalize-model-response";
import { buildKnowledgeSourcesArtifact } from "@/lib/ai/search/source-normalizer";
import type { MessageArtifact, RoomMessage } from "@/lib/types";
import { nowISO, uid } from "@/lib/utils";
import type { IntelligenceContext } from "./intelligence-context";

export type ComposedReply = {
  content: string;
  artifacts?: MessageArtifact[];
  answerSource: "knowledge" | "cache" | "search" | "model";
  skippedEmployeeModel: boolean;
};

export function composeKnowledgeReply(
  intelligence: IntelligenceContext,
): ComposedReply {
  const answer = intelligence.knowledge?.answer?.trim() ?? "";
  const sources = intelligence.knowledge?.sources ?? [];
  const artifacts =
    sources.length > 0
      ? [
          buildKnowledgeSourcesArtifact({
            sources: sources.map((source) => ({
              id: source.id,
              label: source.title,
              providerId: source.providerId,
              memoryId: source.sourceType === "memory" ? source.id : undefined,
              quote: source.excerpt,
              href: source.href,
            })),
            confidence: intelligence.knowledge?.confidence,
            providerId: intelligence.knowledge?.provider,
          }),
        ]
      : undefined;

  return {
    content: sanitizeReplyForChat(answer),
    artifacts,
    answerSource: "knowledge",
    skippedEmployeeModel: true,
  };
}

export function composeCachedSearchReply(
  answer: string,
  artifacts?: MessageArtifact[],
): ComposedReply {
  return {
    content: sanitizeReplyForChat(answer),
    artifacts,
    answerSource: "cache",
    skippedEmployeeModel: true,
  };
}

export async function persistComposedIntelligenceReply(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    employeeId: string;
    employeeName: string;
    composed: ComposedReply;
    agentRunId?: string;
    triggerMessageId?: string;
  },
): Promise<RoomMessage> {
  const aiMessage: RoomMessage = {
    id: uid("msg"),
    roomId: params.roomId,
    topicId: params.topicId,
    senderType: "ai",
    senderId: params.employeeId,
    senderName: params.employeeName,
    content: params.composed.content,
    artifacts: params.composed.artifacts,
    createdAt: nowISO(),
  };

  const { error } = await client.from("messages").insert({
    workspace_id: params.workspaceId,
    id: aiMessage.id,
    room_id: params.roomId,
    topic_id: params.topicId,
    sender_type: "ai",
    sender_id: params.employeeId,
    sender_name: params.employeeName,
    content: aiMessage.content,
    mentions: [],
    mentions_json: [],
    artifacts: params.composed.artifacts ?? null,
    agent_run_id: params.agentRunId ?? null,
    trigger_message_id: params.triggerMessageId ?? null,
    pending: false,
    created_at: aiMessage.createdAt,
  });
  if (error) throw error;

  return aiMessage;
}

export function withComposerMetadata(
  intelligence: IntelligenceContext,
  composed: ComposedReply,
): IntelligenceContext {
  return {
    ...intelligence,
    composer: {
      skippedEmployeeModel: composed.skippedEmployeeModel,
      answerSource: composed.answerSource,
    },
  };
}
