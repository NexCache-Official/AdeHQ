import type { EmployeePromptTier } from "@/lib/ai/prompts";
import type { WorkMode } from "@/lib/ai/intelligence/intelligence-context";
import { messageLikelyNeedsStructuredEffects } from "@/lib/ai/message-intent";

export type ResolveEmployeePromptTierInput = {
  message: string;
  isGreetingRun?: boolean;
  collaborationRole?: string;
  conversationMode?: string;
  workMode?: WorkMode;
  hasFileContext?: boolean;
  hasArtifactIntent?: boolean;
  hasImportedContext?: boolean;
  hasLeadReply?: boolean;
  fastPathDecision?: string;
};

const WORK_SIGNAL =
  /\b(?:write|draft|compose|rewrite|summari[sz]e|outline|brainstorm|plan|create|make|edit|review|analy[sz]e|research|build|prepare|turn this into|follow up|email|task|report|deck|spreadsheet|doc)\b/i;

export function resolveEmployeePromptTier(
  input: ResolveEmployeePromptTierInput,
): EmployeePromptTier {
  if (
    input.hasFileContext ||
    input.hasArtifactIntent ||
    input.hasImportedContext ||
    input.hasLeadReply ||
    input.collaborationRole === "collaborator" ||
    input.collaborationRole === "panelist" ||
    input.conversationMode === "lead_collaborator" ||
    input.conversationMode === "panel_response" ||
    input.workMode === "deep" ||
    input.workMode === "research" ||
    input.workMode === "collaboration"
  ) {
    return "full";
  }

  const text = input.message.trim();

  // A message needing real tool calls (CRM/task/artifact/etc.) must never get the
  // "core" tier — that tier's prompt explicitly tells the model "Do not create
  // tasks, memory, approvals, artifacts, or tool calls," which directly
  // contradicts an explicit request like "Add X as a CRM contact." A short
  // message with no WORK_SIGNAL verb (e.g. "add", not "create") could otherwise
  // fall through to core and have the system prompt itself suppress the tool
  // call it was just asked to make.
  if (messageLikelyNeedsStructuredEffects(text)) {
    return "work";
  }

  if (
    input.isGreetingRun ||
    input.fastPathDecision === "greeting" ||
    (text.length <= 120 && !WORK_SIGNAL.test(text))
  ) {
    return "core";
  }

  return "work";
}
