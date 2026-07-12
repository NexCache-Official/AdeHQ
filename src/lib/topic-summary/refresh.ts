import type { SupabaseClient } from "@supabase/supabase-js";
import { filterMemorySuggestions } from "@/lib/memory/curator";
import { logOrchestrationWorkLog } from "@/lib/orchestration/persistence";
import { nowISO } from "@/lib/utils";
import {
  buildTopicSummaryContextBlock,
  generateTopicSummaryPayload,
  loadTopicSummaryGenerationContext,
} from "./generate";
import { fetchTopicSummary, suppressSummaryIfChatCleared, upsertTopicSummary } from "./persistence";
import { fetchTopicChatClearedAtColumn } from "@/lib/conversation-context/epochs";
import { reconcileTopicSummarySuggestionLifecycle } from "./reconcile-suggestion-lifecycle";
import { reconcileTopicSummaryNextActions } from "./reconcile-next-actions";
import {
  TOPIC_SUMMARY_AUTO_COOLDOWN_MS,
  TOPIC_SUMMARY_FAILURE_COOLDOWN_MS,
  type TopicSummary,
  type TopicSummaryRefreshTrigger,
} from "./types";

export type RefreshTopicSummaryResult = {
  summary: TopicSummary | null;
  refreshed: boolean;
  skippedReason?: string;
};

/**
 * Best-effort, per-process backoff for topics whose auto-refresh just failed.
 * Not persisted (a schema change would need explicit user sign-off), so it only
 * guards within a single server instance — still enough to stop a chatty topic
 * from re-attempting (and re-burning tokens on) the same failing generation on
 * every subsequent AI reply.
 */
const recentGenerationFailures = new Map<string, number>();

function failureKey(workspaceId: string, topicId: string): string {
  return `${workspaceId}:${topicId}`;
}

function summariesMeaningfullyChanged(
  previous: TopicSummary | null,
  next: TopicSummary,
): boolean {
  if (!previous) return Boolean(next.summary.trim());
  if (previous.summary.trim() !== next.summary.trim()) return true;
  if (previous.whatHappened.trim() !== next.whatHappened.trim()) return true;
  if ((previous.currentDecision ?? "") !== (next.currentDecision ?? "")) return true;
  return (
    JSON.stringify(previous.openQuestions) !== JSON.stringify(next.openQuestions) ||
    JSON.stringify(previous.keyFacts) !== JSON.stringify(next.keyFacts) ||
    JSON.stringify(previous.nextActions) !== JSON.stringify(next.nextActions) ||
    JSON.stringify(previous.suggestedMemory) !== JSON.stringify(next.suggestedMemory)
  );
}

export function shouldAutoRefreshTopicSummary(
  trigger: TopicSummaryRefreshTrigger,
): boolean {
  switch (trigger) {
    case "manual":
      return true;
    case "meaningful_ai_reply":
    case "panel_collaboration_completed":
    case "handoff_completed":
    case "topic_created":
    case "task_created":
    case "memory_suggested":
    case "approval_requested":
      return true;
    default:
      return false;
  }
}

export async function refreshTopicSummary(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    topicTitle: string;
    topicDescription?: string | null;
    trigger?: TopicSummaryRefreshTrigger;
    manual?: boolean;
    force?: boolean;
    employeeId?: string;
    /** When false, skip writing topic-summary work log events (e.g. employee DMs). */
    logWorkEvents?: boolean;
  },
): Promise<RefreshTopicSummaryResult> {
  const trigger = params.trigger ?? (params.manual ? "manual" : "meaningful_ai_reply");
  const manual = Boolean(params.manual || trigger === "manual");
  const force = Boolean(params.force);
  const logWorkEvents = params.logWorkEvents !== false;

  if (!shouldAutoRefreshTopicSummary(trigger)) {
    return { summary: null, refreshed: false, skippedReason: "trigger_not_eligible" };
  }

  if (!manual) {
    const failedAt = recentGenerationFailures.get(failureKey(params.workspaceId, params.topicId));
    if (failedAt && Date.now() - failedAt < TOPIC_SUMMARY_FAILURE_COOLDOWN_MS) {
      return { summary: null, refreshed: false, skippedReason: "recent_generation_failure" };
    }
  }

  const existing = await fetchTopicSummary(client, params.workspaceId, params.topicId);

  if (
    !manual &&
    existing?.lastRefreshedAt &&
    Date.now() - +new Date(existing.lastRefreshedAt) < TOPIC_SUMMARY_AUTO_COOLDOWN_MS
  ) {
    return { summary: existing, refreshed: false, skippedReason: "cooldown" };
  }

  const ctx = await loadTopicSummaryGenerationContext(
    client,
    params.workspaceId,
    params.topicId,
    params.roomId,
  );

  const chatClearedAt = await fetchTopicChatClearedAtColumn(client, params.workspaceId, params.topicId);
  if (chatClearedAt && ctx.messages.length === 0) {
    await suppressSummaryIfChatCleared(client, params.workspaceId, params.topicId);
    return { summary: null, refreshed: false, skippedReason: "chat_cleared" };
  }

  const useArchivedSummary = !chatClearedAt && !force;
  const existingForContext = useArchivedSummary ? existing : null;

  if (!manual && ctx.messages.length < 3) {
    return { summary: existingForContext, refreshed: false, skippedReason: "insufficient_messages" };
  }

  const contextBlock = buildTopicSummaryContextBlock({
    topicTitle: params.topicTitle,
    topicDescription: params.topicDescription,
    existing: existingForContext,
    messages: ctx.messages,
    tasks: ctx.tasks,
    memory: ctx.memory,
    approvals: ctx.approvals,
    workLogs: ctx.workLogs,
    employees: ctx.employees,
  });

  const generated = await generateTopicSummaryPayload(contextBlock, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    sourceMessageCount: ctx.messages.length,
    client,
  });

  if (generated.generationFailed) {
    if (!manual) {
      recentGenerationFailures.set(failureKey(params.workspaceId, params.topicId), Date.now());
    }
    return { summary: existingForContext, refreshed: false, skippedReason: "generation_failed" };
  }

  if (generated.isCasualConversation && !manual) {
    return { summary: existingForContext, refreshed: false, skippedReason: "casual_conversation" };
  }

  if (generated.isCasualConversation && manual && !force && !generated.summary.trim()) {
    return { summary: existingForContext, refreshed: false, skippedReason: "casual_conversation" };
  }

  recentGenerationFailures.delete(failureKey(params.workspaceId, params.topicId));

  const nextSummary: TopicSummary = {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    summary: generated.summary.trim(),
    whatHappened: generated.whatHappened.trim(),
    currentDecision: generated.currentDecision?.trim() || null,
    openQuestions: generated.openQuestions,
    keyFacts: generated.keyFacts,
    nextActions: reconcileTopicSummaryNextActions(generated.nextActions, ctx.tasks),
    suggestedMemory: filterMemorySuggestions(generated.suggestedMemory),
    sourceMessageIds: ctx.sourceMessageIds,
    sourceWorkLogIds: ctx.sourceWorkLogIds,
    lastRefreshedAt: nowISO(),
    memorySuggestionLifecycle: existing?.memorySuggestionLifecycle ?? {},
  };

  const reconciledSummary = await reconcileTopicSummarySuggestionLifecycle(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    userId: params.employeeId ?? "system",
    summary: nextSummary,
  });

  const changed = summariesMeaningfullyChanged(existing, reconciledSummary);
  if (!manual && !changed) {
    return { summary: existingForContext, refreshed: false, skippedReason: "no_meaningful_change" };
  }

  if (manual && !force && !changed && existingForContext) {
    return { summary: existingForContext, refreshed: false, skippedReason: "no_meaningful_change" };
  }

  if (chatClearedAt && ctx.messages.length === 0) {
    await suppressSummaryIfChatCleared(client, params.workspaceId, params.topicId);
    return { summary: null, refreshed: false, skippedReason: "chat_cleared" };
  }

  const saved = await upsertTopicSummary(client, reconciledSummary);

  const employeeId = params.employeeId ?? "system";

  if (manual || changed) {
    if (logWorkEvents) {
      await logOrchestrationWorkLog(client, {
        workspaceId: params.workspaceId,
        roomId: params.roomId,
        topicId: params.topicId,
        employeeId,
        action: "topic_summary_refreshed",
        summary: manual
          ? `Refreshed topic summary: ${params.topicTitle}`
          : `Updated topic summary after ${trigger.replace(/_/g, " ")}`,
        relatedEntityType: "topic",
        relatedEntityId: params.topicId,
      });
    }
  }

  if (saved.suggestedMemory.length > 0 && changed) {
    if (logWorkEvents) {
      await logOrchestrationWorkLog(client, {
        workspaceId: params.workspaceId,
        roomId: params.roomId,
        topicId: params.topicId,
        employeeId,
        action: "topic_memory_suggested",
        summary: `${saved.suggestedMemory.length} memory suggestion(s) for ${params.topicTitle}`,
        relatedEntityType: "topic",
        relatedEntityId: params.topicId,
      });
    }
  }

  if (saved.nextActions.length > 0 && changed) {
    if (logWorkEvents) {
      await logOrchestrationWorkLog(client, {
        workspaceId: params.workspaceId,
        roomId: params.roomId,
        topicId: params.topicId,
        employeeId,
        action: "next_actions_suggested",
        summary: `${saved.nextActions.length} next action(s) for ${params.topicTitle}`,
        relatedEntityType: "topic",
        relatedEntityId: params.topicId,
      });
    }
  }

  return { summary: saved, refreshed: true };
}

/** Fire-and-forget auto refresh — never throws to caller. */
export function scheduleTopicSummaryRefresh(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    topicTitle: string;
    topicDescription?: string | null;
    trigger: TopicSummaryRefreshTrigger;
    employeeId?: string;
  },
): void {
  void refreshTopicSummary(client, { ...params, manual: false }).catch((error) => {
    console.warn("[AdeHQ topic summary] auto refresh failed", error);
  });
}
