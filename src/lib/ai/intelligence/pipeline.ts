import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAmbientContext,
  type AmbientContext,
} from "@/lib/ai/ambient-context";
import type { MemoryEntry } from "@/lib/types";
import type { FileContextBundle } from "@/lib/server/file-context";
import {
  createIntelligenceContext,
  type IntelligenceContext,
  type WorkMode,
} from "./intelligence-context";
import { classifyMessageFastPath } from "./classify-message-fast-path";
import { assignThinkingBudget } from "./thinking-budget";
import {
  queryKnowledgeProviders,
  type KnowledgeProvider,
} from "./knowledge-provider";
import { workspaceMemoryProvider } from "./providers/workspace-memory-provider";
import { sempackProvider } from "./providers/sempack-provider";
import { appendIntelligenceStep, withIntelligenceStep } from "./telemetry";
import { runIntelligenceRouter } from "./intelligence-router";
import type { RoomMessage } from "@/lib/types";
import {
  resolveInstantAnswer,
  type InstantAnswerInput,
} from "./instant-answers";

export const MEMORY_ANSWER_THRESHOLD = 0.85;
export const SEARCH_ANSWER_THRESHOLD = 0.7;

export type IntelligencePreludeInput = {
  workspaceId: string;
  roomId: string;
  topicId: string;
  messageId: string;
  userMessage: string;
  selectedEmployeeId?: string;
  workMode?: WorkMode;
  preferFastSearch?: boolean;
  preferAgentMode?: boolean;
  hasRecentContext?: boolean;
  memoryEntries?: MemoryEntry[];
  topicSummary?: string | null;
  fileContext?: FileContextBundle;
  knowledgeProviders?: KnowledgeProvider[];
  ambientContext?: AmbientContext;
  workspaceName?: string;
  userName?: string;
  roomName?: string;
  topicTitle?: string;
  topicDescription?: string | null;
  openTasks?: InstantAnswerInput["openTasks"];
  roomEmployees?: InstantAnswerInput["roomEmployees"];
  humanParticipants?: InstantAnswerInput["humanParticipants"];
};

export type IntelligenceEnrichmentInput = IntelligencePreludeInput & {
  recentMessages?: RoomMessage[];
  capabilitiesSummary?: string;
};

export async function runIntelligencePrelude(
  client: SupabaseClient,
  input: IntelligencePreludeInput,
): Promise<IntelligenceContext> {
  const fastPath = classifyMessageFastPath(input.userMessage, {
    workMode: input.workMode,
    preferFastSearch: input.preferFastSearch,
    preferAgentMode: input.preferAgentMode,
    hasRecentContext: input.hasRecentContext,
  });
  let context = createIntelligenceContext(input);
  context = {
    ...context,
    fastPath: {
      decision: fastPath.decision,
      confidence: fastPath.confidence,
      reason: fastPath.reason,
      suggestedSearchQuery: fastPath.suggestedSearchQuery,
    },
    thinkingBudget: assignThinkingBudget({
      fastPath: fastPath.decision,
      workMode: input.workMode,
    }),
  };
  context = appendIntelligenceStep(context, {
    layer: "fast_path",
    decision: fastPath.decision,
    confidence: fastPath.confidence,
    durationMs: 0,
    metadata: {
      reason: fastPath.reason,
      suggestedSearchQuery: fastPath.suggestedSearchQuery,
    },
  });
  context = appendIntelligenceStep(context, {
    layer: "budget",
    decision: `assigned_${context.thinkingBudget.assigned}`,
    confidence: 1,
    durationMs: 0,
    metadata: context.thinkingBudget,
  });

  const ambient =
    input.ambientContext ??
    createAmbientContext({
      workspaceName: input.workspaceName,
      userName: input.userName,
    });
  const instant = resolveInstantAnswer({
    message: input.userMessage,
    ambient,
    roomName: input.roomName,
    topicTitle: input.topicTitle,
    topicDescription: input.topicDescription,
    topicSummary: input.topicSummary,
    openTasks: input.openTasks,
    roomEmployees: input.roomEmployees,
    humanParticipants: input.humanParticipants,
  });
  if (instant) {
    context = appendIntelligenceStep(context, {
      layer: "composer",
      decision: `instant_${instant.kind}`,
      confidence: instant.confidence,
      durationMs: 0,
      metadata: {
        fact: instant.fact,
      },
    });
    return {
      ...context,
      instantAnswer: instant,
      researchLevel: 0,
      composer: {
        skippedEmployeeModel: true,
        answerSource: "instant",
      },
    };
  }

  const knowledgeStep = await withIntelligenceStep(
    context,
    "knowledge",
    async () => {
      const result = await queryKnowledgeProviders(
        input.knowledgeProviders ?? [workspaceMemoryProvider, sempackProvider],
        {
          workspaceId: input.workspaceId,
          roomId: input.roomId,
          topicId: input.topicId,
          query: input.userMessage,
          memoryEntries: input.memoryEntries,
          topicSummary: input.topicSummary,
          fileContext: input.fileContext,
        },
        client,
      );
      return {
        value: result,
        decision:
          result.found && result.confidence >= MEMORY_ANSWER_THRESHOLD
            ? "answer_from_knowledge"
            : result.found
              ? "knowledge_below_threshold"
              : "knowledge_miss",
        confidence: result.confidence,
        metadata: {
          providerId: result.providerId,
          sourceCount: result.sources.length,
          candidates: result.candidates.map((candidate) => ({
            providerId: candidate.providerId,
            found: candidate.found,
            confidence: candidate.confidence,
          })),
        },
      };
    },
  );

  return {
    ...knowledgeStep.context,
    knowledge: {
      provider: knowledgeStep.value.providerId,
      found: knowledgeStep.value.found,
      confidence: knowledgeStep.value.confidence,
      answer: knowledgeStep.value.answer,
      sources: knowledgeStep.value.sources,
    },
  };
}

export async function enrichIntelligenceContext(
  client: SupabaseClient,
  input: IntelligenceEnrichmentInput,
): Promise<IntelligenceContext> {
  let context = await runIntelligencePrelude(client, input);

  if (context.fastPath?.decision === "needs_router") {
    const recent =
      input.recentMessages
        ?.slice(-8)
        .map((message) =>
          `${message.senderType === "human" ? "User" : message.senderName}: ${message.content.trim()}`,
        )
        .join("\n") ?? undefined;
    context = await runIntelligenceRouter(context, {
      recentMessages: recent,
      capabilitiesSummary: input.capabilitiesSummary,
    });
  }

  return context;
}

export function shouldAnswerFromKnowledge(
  context: IntelligenceContext | undefined,
): boolean {
  const knowledge = context?.knowledge;
  return Boolean(
    knowledge?.found &&
      knowledge.confidence >= MEMORY_ANSWER_THRESHOLD &&
      knowledge.answer,
  );
}

export function shouldAnswerInstantly(
  context: IntelligenceContext | undefined,
): boolean {
  return Boolean(
    context?.instantAnswer?.reply &&
      context.composer?.answerSource === "instant" &&
      context.composer.skippedEmployeeModel,
  );
}
