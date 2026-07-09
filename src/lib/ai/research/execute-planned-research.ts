import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAndRunBrowserResearch,
  loadWorkspaceEmployee,
  type CreateBrowserResearchRunParams,
} from "@/lib/ai/browser-research/server";
import type { BrowserResearchRun } from "@/lib/ai/browser-research/types";
import { sanitizeReplyForChat } from "@/lib/ai/normalize-model-response";
import { executeSearchAnswer } from "@/lib/ai/search/search-answer";
import { isGatewayResearchProvider } from "@/lib/ai/research/research-provider";
import {
  assertGatewaySearchPlanAccess,
  PlanEntitlementError,
} from "@/lib/billing/plans/entitlements";
import type { GatewaySearchRunMeta, SearchAnswerResult } from "@/lib/ai/search/types";
import type { MessageArtifact, RoomMessage } from "@/lib/types";
import { nowISO, uid } from "@/lib/utils";
import type { ResearchPlan } from "./research-planner";

export type ExecutePlannedResearchParams = {
  workspaceId: string;
  roomId: string;
  topicId: string;
  employeeId: string;
  createdBy: string;
  plan: ResearchPlan;
  triggerMessageId?: string;
  agentRunId?: string;
};

export type ExecutePlannedResearchResult = {
  run?: BrowserResearchRun;
  chatReply: RoomMessage | null;
  plan: ResearchPlan;
  async: boolean;
  searchAnswer?: {
    route: string;
    providerRoute?: SearchAnswerResult["providerRoute"];
    estimatedCostUsd: number;
    estimatedWorkMinutes: number;
    searchMeta?: GatewaySearchRunMeta;
    fromCache?: boolean;
    cacheKey?: string;
  };
};

async function persistGatewaySearchChatReply(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    employeeId: string;
    employeeName: string;
    content: string;
    artifacts?: MessageArtifact[];
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
    content: sanitizeReplyForChat(params.content),
    artifacts: params.artifacts,
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
    artifacts: params.artifacts ?? null,
    agent_run_id: params.agentRunId ?? null,
    trigger_message_id: params.triggerMessageId ?? null,
    pending: false,
    created_at: aiMessage.createdAt,
  });
  if (error) throw error;

  return aiMessage;
}

/** Run browser/search research from a planner decision and synthesize a chat reply. */
export async function executePlannedResearch(
  client: SupabaseClient,
  params: ExecutePlannedResearchParams,
): Promise<ExecutePlannedResearchResult> {
  const query = (params.plan.researchQuery ?? params.plan.resolved.query).trim();
  if (!query) {
    throw new Error("Research plan is missing a query.");
  }

  if (isGatewayResearchProvider(params.plan.provider) || params.plan.provider === "tavily") {
    await assertGatewaySearchPlanAccess(client, params.workspaceId);
    const employee = await loadWorkspaceEmployee(client, params.workspaceId, params.employeeId);
    const searchResult = await executeSearchAnswer({
      client,
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      employeeId: params.employeeId,
      employeeName: employee?.name,
      query,
      agentRunId: params.agentRunId,
      routeOverride:
        params.plan.provider === "gateway_exa"
          ? "gateway_exa"
          : params.plan.provider === "gateway_parallel"
            ? "gateway_parallel"
            : params.plan.provider === "tavily"
              ? "tavily"
            : "gateway_perplexity",
    });

    const artifacts = searchResult.webSourcesArtifact
      ? [searchResult.webSourcesArtifact]
      : searchResult.searchSourcesArtifact
        ? [searchResult.searchSourcesArtifact]
        : undefined;

    const chatReply = await persistGatewaySearchChatReply(client, {
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      employeeId: params.employeeId,
      employeeName: employee?.name ?? "AI",
      content: searchResult.answer,
      artifacts,
      agentRunId: params.agentRunId,
      triggerMessageId: params.triggerMessageId,
    });

    return {
      chatReply,
      plan: params.plan,
      async: false,
      searchAnswer: {
        route: searchResult.route,
        providerRoute: searchResult.providerRoute,
        estimatedCostUsd: searchResult.estimatedCostUsd,
        estimatedWorkMinutes: searchResult.estimatedWorkMinutes,
        searchMeta: searchResult.searchMeta,
        fromCache: searchResult.fromCache,
        cacheKey: searchResult.cacheKey,
      },
    };
  }

  const runParams: CreateBrowserResearchRunParams = {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    employeeId: params.employeeId,
    createdBy: params.createdBy,
    query,
    provider:
      params.plan.provider === "browserbase" || params.plan.provider === "tavily"
        ? params.plan.provider
        : undefined,
    triggerMessageId: params.triggerMessageId,
    userQuestion: params.plan.userQuestion,
    plannerReasoning: params.plan.reasoning,
    resolvedFrom: params.plan.resolved.resolvedFrom,
    agentRunId: params.agentRunId,
  };

  try {
    const { run, chatReply, async: isAsync } = await createAndRunBrowserResearch(client, runParams);
    return { run, chatReply, plan: params.plan, async: isAsync };
  } catch (error) {
    // Plan doesn't include browser research: skip silently so the autonomous reply flow
    // continues with a normal answer instead of failing the whole run.
    if (error instanceof PlanEntitlementError) {
      return { chatReply: null, plan: params.plan, async: false };
    }
    throw error;
  }
}
