import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAndRunBrowserResearch,
  type CreateBrowserResearchRunParams,
} from "@/lib/ai/browser-research/server";
import type { BrowserResearchRun } from "@/lib/ai/browser-research/types";
import type { RoomMessage } from "@/lib/types";
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
  run: BrowserResearchRun;
  chatReply: RoomMessage | null;
  plan: ResearchPlan;
  async: boolean;
};

/** Run browser/search research from a planner decision and synthesize a chat reply. */
export async function executePlannedResearch(
  client: SupabaseClient,
  params: ExecutePlannedResearchParams,
): Promise<ExecutePlannedResearchResult> {
  const query = (params.plan.researchQuery ?? params.plan.resolved.query).trim();
  if (!query) {
    throw new Error("Research plan is missing a query.");
  }

  const runParams: CreateBrowserResearchRunParams = {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    employeeId: params.employeeId,
    createdBy: params.createdBy,
    query,
    provider: params.plan.provider,
    triggerMessageId: params.triggerMessageId,
    userQuestion: params.plan.userQuestion,
    plannerReasoning: params.plan.reasoning,
    resolvedFrom: params.plan.resolved.resolvedFrom,
    agentRunId: params.agentRunId,
  };

  const { run, chatReply, async: isAsync } = await createAndRunBrowserResearch(client, runParams);
  return { run, chatReply, plan: params.plan, async: isAsync };
}
