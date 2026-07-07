import { generateObject } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTopicChatClearedAtColumn } from "@/lib/conversation-context/epochs";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { resolveModel } from "@/lib/ai/model-catalog";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { generateObject as runtimeGenerateObject, planRoute } from "@/lib/ai/runtime";
import { siliconFlowChatModel } from "@/lib/ai/siliconflow-client";
import {
  completeAiWorkUnit,
  createAiWorkUnit,
  failAiWorkUnit,
  startAiWorkUnit,
} from "@/lib/supabase/ai-work-units";
import type { TopicSummary } from "./types";

const summarySchema = z.object({
  summary: z.string(),
  whatHappened: z.string(),
  currentDecision: z.string().nullable(),
  openQuestions: z.array(
    z.object({
      text: z.string(),
      sourceMessageId: z.string().optional(),
    }),
  ),
  keyFacts: z.array(
    z.object({
      text: z.string(),
      sourceMessageId: z.string().optional(),
    }),
  ),
  nextActions: z.array(
    z.object({
      title: z.string(),
      ownerEmployeeId: z.string().optional(),
      sourceMessageId: z.string().optional(),
      status: z
        .enum(["Planned", "In progress", "Completed", "Waiting for clarification"])
        .optional(),
    }),
  ),
  suggestedMemory: z.array(
    z.object({
      title: z.string().optional(),
      content: z.string().optional(),
      text: z.string(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      scope: z.enum(["workspace", "room", "topic", "employee"]),
      reason: z.string(),
      sourceMessageId: z.string().optional(),
      suggestedByEmployeeId: z.string().optional(),
    }),
  ),
  isCasualConversation: z.boolean().optional(),
});

export type GeneratedTopicSummaryPayload = z.infer<typeof summarySchema>;

export const topicSummarySchema = summarySchema;

const TOPIC_SUMMARY_SYSTEM = `You maintain durable workstream summaries for AdeHQ topics.
Return JSON only matching the schema.

Rules:
- Be concise and factual. Do not invent facts.
- CRITICAL: Distinguish PLANNED work from COMPLETED work. Never describe proposals, intentions, or future plans as finished outcomes.
- Do not write "Alex will identify leads" as if it already happened. Use honest phrasing: "Alex proposed…", "Planned:", or "Still requires…".
- nextActions are proposals — default status "Planned". Use "Completed" only when work logs or messages show the work was done.
- Never include nextActions that duplicate an item already listed under Open tasks — reference existing tasks in whatHappened, currentDecision, or keyFacts instead.
- Do not repeat the same nextAction twice. One card per distinct follow-up only.
- Use status on nextActions: Planned | In progress | Completed | Waiting for clarification.
- Do not claim live external research, web searches, lead lists, market sizing, or competitor data unless work logs reference browser/search/file tools or uploaded sources were used.
- If employees discussed research or outreach but no tools ran, say what was proposed and note that live execution still requires browser/search access or uploaded data.
- For health supplements, regulated products, or medical claims: include a brief compliance caveat in summary or keyFacts when relevant (not medical/legal advice; verify regulations).
- Use "No decision yet" as currentDecision only when no decision was made; otherwise use null when unclear.
- openQuestions, keyFacts, nextActions, and suggestedMemory should be short bullet-quality items.
- NEVER include raw message IDs, UUIDs, or [msg_...] references inside text fields — use sourceMessageId only.
- Preserve sourceMessageId from message IDs in brackets when an item came from a specific message.
- suggestedMemory is a suggestion only — never imply it was saved.
- Do NOT suggest memory for transactional tool activity already captured elsewhere: "created contact/deal/company/task", "CRM setup started", "email draft created", "spreadsheet generated", or summaries of recent tool execution. Those belong in CRM, Tasks, Drive, or Work Log.
- Suggest memory only for durable business context: target accounts, primary contacts, preferences, positioning, compliance notes, ICP — not activity logs.
- For suggestedMemory: provide a short clean title (max ~8 words), 1–2 sentence content, category from: Company Context, Product / Service, Market Research, Sales, Customer / Client, Marketing, Operations, Decision, Preference, People / Workforce, Process / Playbook, File Finding, Topic Summary, Employee-Specific Context, Other.
- Include 2–6 lowercase tags for retrieval. Prefer topic or room scope unless truly workspace-wide.
- suggestedByEmployeeId: employee id when an AI message inspired the suggestion.
- Set isCasualConversation true when the thread is only greetings, thanks, or small talk with no work substance.
- If casual, keep summary minimal and leave lists mostly empty.
- whatHappened should describe what was actually discussed or completed in the thread, not promises about future work.
- ownerEmployeeId must be an employee id from the context when assigning next actions.`;

const TOPIC_SUMMARY_MAX_TOKENS = 1400;

export type TopicSummaryTestHooks = {
  /** When set, generateTopicSummaryPayloadRuntime throws before calling runtime. */
  forceRuntimeFailure?: boolean | Error;
  /** When set, generateTopicSummaryPayloadOld returns this payload (test only). */
  stubOldPayload?: GeneratedTopicSummaryPayload;
  /** Called when on-mode runtime fails and fallback begins. */
  onRuntimeFallback?: (info: { error: string; workUnitFailed: boolean }) => void;
};

let topicSummaryTestHooks: TopicSummaryTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setTopicSummaryTestHooks(hooks: TopicSummaryTestHooks | null): void {
  topicSummaryTestHooks = hooks;
}

export type TopicSummaryGenerationOptions = {
  workspaceId?: string;
  roomId?: string;
  topicId?: string;
  sourceMessageCount?: number;
  client?: SupabaseClient;
};

export type TopicSummaryRuntimeDispatch = "old" | "shadow" | "runtime-on";

export function getTopicSummaryRuntimeDispatch(): TopicSummaryRuntimeDispatch {
  const { mode } = getRuntimeFlags();
  if (mode === "on") return "runtime-on";
  if (mode === "shadow") return "shadow";
  return "old";
}

type BuildContextParams = {
  topicTitle: string;
  topicDescription?: string | null;
  existing?: TopicSummary | null;
  messages: Array<{ id: string; senderName: string; content: string; createdAt: string }>;
  tasks: Array<{ id?: string; title: string; status: string; priority: string }>;
  memory: Array<{ title: string; content: string; status: string }>;
  approvals: Array<{ title: string; status: string; risk: string }>;
  workLogs: Array<{ id: string; action: string; summary: string }>;
  employees: Array<{ id: string; name: string; role: string }>;
};

export function buildTopicSummaryContextBlock(params: BuildContextParams): string {
  const lines = [
    `Topic: ${params.topicTitle}`,
    params.topicDescription ? `Description: ${params.topicDescription}` : "",
    "",
    params.existing?.summary ? `Previous summary: ${params.existing.summary}` : "",
    params.existing?.currentDecision
      ? `Previous decision: ${params.existing.currentDecision}`
      : "",
    "",
    "Recent messages (newest last):",
    ...params.messages.map((m) => `[${m.id}] ${m.senderName}: ${m.content}`),
    "",
    "Open tasks:",
    ...params.tasks.map((t) => `- [${t.status}] ${t.title} (${t.priority})`),
    "",
    "Topic memory:",
    ...params.memory.map((m) => `- [${m.status}] ${m.title}: ${m.content.slice(0, 240)}`),
    "",
    "Pending approvals:",
    ...params.approvals
      .filter((a) => a.status === "pending")
      .map((a) => `- ${a.title} (${a.risk})`),
    "",
    "Recent work logs:",
    ...params.workLogs.map((w) => `- [${w.id}] ${w.action}: ${w.summary}`),
    "",
    "AI employees in room:",
    ...params.employees.map((e) => `- ${e.id}: ${e.name} (${e.role})`),
  ];

  return lines.filter((line) => line !== undefined).join("\n");
}

/** Direct SiliconFlow path — unchanged from pre-Runtime V2 behavior. */
export async function generateTopicSummaryPayloadOld(
  contextBlock: string,
): Promise<GeneratedTopicSummaryPayload> {
  if (topicSummaryTestHooks?.stubOldPayload) {
    return topicSummaryTestHooks.stubOldPayload;
  }

  const model = siliconFlowChatModel(resolveModel("siliconflow", "balanced"));

  const { object } = await generateObject({
    model,
    schema: summarySchema,
    system: TOPIC_SUMMARY_SYSTEM,
    prompt: contextBlock,
    maxOutputTokens: TOPIC_SUMMARY_MAX_TOKENS,
  });

  return object;
}

async function recordShadowPlanning(
  contextBlock: string,
  options: TopicSummaryGenerationOptions,
): Promise<void> {
  try {
    const routing = planRoute(
      {
        capability: "summarization",
        message: contextBlock.slice(0, 500),
        workspaceId: options.workspaceId,
      },
      { forceMode: "shadow" },
    );

    recordAiRuntime({
      provider: routing.providerName,
      model: routing.modelId,
      mode: "fallback",
      fallbackReason: "topic_summary_shadow_plan",
      workspaceId: options.workspaceId,
      roomId: options.roomId,
      estimatedCostUsd: routing.estimatedCostUsd,
    });

    if (options.client && options.workspaceId) {
      await createAiWorkUnit(options.client, {
        workspaceId: options.workspaceId,
        roomId: options.roomId,
        topicId: options.topicId,
        workType: "topic_summary",
        capability: "summarization",
        objective: "Shadow plan for topic summary",
        status: "planned",
        runtimeMode: routing.runtimeMode,
        providerRoute: routing.providerRoute,
        providerName: routing.providerName,
        modelId: routing.modelId,
        estimatedCostUsd: routing.estimatedCostUsd,
        estimatedWorkMinutes: routing.estimatedWorkMinutes,
        metadata: {
          shadow: true,
          topicId: options.topicId,
          roomId: options.roomId,
          sourceMessageCount: options.sourceMessageCount,
        },
      });
    }
  } catch (error) {
    console.warn("[AdeHQ topic summary shadow]", error);
  }
}

/** Runtime V2 path — used when AI_RUNTIME_V2_MODE=on. */
export async function generateTopicSummaryPayloadRuntime(
  contextBlock: string,
  options: TopicSummaryGenerationOptions = {},
): Promise<GeneratedTopicSummaryPayload> {
  if (topicSummaryTestHooks?.forceRuntimeFailure) {
    throw topicSummaryTestHooks.forceRuntimeFailure instanceof Error
      ? topicSummaryTestHooks.forceRuntimeFailure
      : new Error("Forced topic summary runtime failure (test hook)");
  }

  let workUnitId: string | undefined;

  if (options.client && options.workspaceId) {
    try {
      const created = await createAiWorkUnit(options.client, {
        workspaceId: options.workspaceId,
        roomId: options.roomId,
        topicId: options.topicId,
        workType: "topic_summary",
        capability: "summarization",
        objective: "Generate topic summary",
        runtimeMode: "balanced",
        metadata: {
          topicId: options.topicId,
          roomId: options.roomId,
          workspaceId: options.workspaceId,
          sourceMessageCount: options.sourceMessageCount,
        },
      });
      workUnitId = created.id;
      await startAiWorkUnit(options.client, options.workspaceId, workUnitId, {
        runtimeMode: "balanced",
        reasoningProfile: "low",
      });
    } catch (error) {
      console.warn("[AdeHQ topic summary work unit]", error);
    }
  }

  const result = await runtimeGenerateObject(
    {
      workspaceId: options.workspaceId,
      workUnitId,
      capability: "summarization",
      runtimeMode: "balanced",
      reasoningProfile: "low",
      schema: summarySchema,
      system: TOPIC_SUMMARY_SYSTEM,
      prompt: contextBlock,
      maxTokens: TOPIC_SUMMARY_MAX_TOKENS,
      preferJsonMode: true,
      metadata: {
        topicId: options.topicId,
        roomId: options.roomId,
        workspaceId: options.workspaceId,
        sourceMessageCount: options.sourceMessageCount,
      },
    },
    { forceMode: "on" },
  );

  const parsed = summarySchema.safeParse(result.object);
  if (!parsed.success) {
    throw new Error("Runtime topic summary output failed schema validation.");
  }

  if (options.client && options.workspaceId && workUnitId) {
    try {
      await completeAiWorkUnit(options.client, options.workspaceId, workUnitId, {
        actualCostUsd: result.usage.totalCostUsd,
        actualWorkMinutes: result.workMinutesEstimated,
        metadata: {
          providerRoute: result.usage.providerRoute,
          modelId: result.usage.modelId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      });
    } catch (error) {
      console.warn("[AdeHQ topic summary work unit complete]", error);
    }
  }

  recordAiRuntime({
    provider: result.usage.providerName,
    model: result.usage.modelId,
    mode: "live",
    workspaceId: options.workspaceId,
    roomId: options.roomId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedCostUsd: result.usage.totalCostUsd,
    durationMs: result.usage.latencyMs,
    agentRunId: workUnitId,
  });

  return parsed.data;
}

/**
 * Generate topic summary payload.
 * Dispatches by AI_RUNTIME_V2_MODE: off → old, shadow → old + shadow plan, on → runtime with fallback.
 */
export async function generateTopicSummaryPayload(
  contextBlock: string,
  options: TopicSummaryGenerationOptions = {},
): Promise<GeneratedTopicSummaryPayload> {
  const dispatch = getTopicSummaryRuntimeDispatch();

  if (dispatch === "runtime-on") {
    try {
      return await generateTopicSummaryPayloadRuntime(contextBlock, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAiRuntime({
        provider: "siliconflow",
        model: resolveModel("siliconflow", "balanced"),
        mode: "fallback",
        fallbackReason: "topic_summary_runtime_failed",
        workspaceId: options.workspaceId,
        roomId: options.roomId,
        error: message,
      });

      let workUnitFailed = false;
      if (options.client && options.workspaceId) {
        try {
          const failed = await createAiWorkUnit(options.client, {
            workspaceId: options.workspaceId,
            roomId: options.roomId,
            topicId: options.topicId,
            workType: "topic_summary",
            capability: "summarization",
            objective: "Runtime topic summary failed — fell back to legacy path",
            status: "failed",
            metadata: { fallback: true, error: message },
          });
          await failAiWorkUnit(
            options.client,
            options.workspaceId,
            failed.id,
            message,
          );
          workUnitFailed = true;
        } catch {
          // debug only
        }
      }

      topicSummaryTestHooks?.onRuntimeFallback?.({ error: message, workUnitFailed });

      return generateTopicSummaryPayloadOld(contextBlock);
    }
  }

  if (dispatch === "shadow") {
    void recordShadowPlanning(contextBlock, options);
    return generateTopicSummaryPayloadOld(contextBlock);
  }

  return generateTopicSummaryPayloadOld(contextBlock);
}

export async function loadTopicSummaryGenerationContext(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
  roomId: string,
) {
  const chatClearedAt = await fetchTopicChatClearedAtColumn(client, workspaceId, topicId);

  let messagesQuery = client
    .from("messages")
    .select("id, sender_name, content, created_at")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (chatClearedAt) {
    messagesQuery = messagesQuery.gte("created_at", chatClearedAt);
  }

  let workLogsQuery = client
    .from("work_log_events")
    .select("id, action, summary, created_at")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false })
    .limit(15);

  if (chatClearedAt) {
    workLogsQuery = workLogsQuery.gte("created_at", chatClearedAt);
  }

  let tasksQuery = client
    .from("tasks")
    .select("id, title, status, priority, created_at")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .limit(20);
  let memoryQuery = client
    .from("memory_entries")
    .select("title, content, status, created_at")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .limit(12);
  let approvalsQuery = client
    .from("approvals")
    .select("title, status, risk, created_at")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .limit(10);

  if (chatClearedAt) {
    tasksQuery = tasksQuery.gte("created_at", chatClearedAt);
    memoryQuery = memoryQuery.gte("created_at", chatClearedAt);
    approvalsQuery = approvalsQuery.gte("created_at", chatClearedAt);
  }

  const [messagesResult, tasksResult, memoryResult, approvalsResult, logsResult, employeesResult] =
    await Promise.all([
      messagesQuery,
      tasksQuery,
      memoryQuery,
      approvalsQuery,
      workLogsQuery,
      client
        .from("ai_employees")
        .select("id, name, role")
        .eq("workspace_id", workspaceId)
        .limit(30),
    ]);

  const messages = ((messagesResult.data ?? []) as Record<string, unknown>[])
    .reverse()
    .map((row) => ({
      id: String(row.id),
      senderName: String(row.sender_name ?? "Unknown"),
      content: String(row.content ?? ""),
      createdAt: String(row.created_at),
    }));

  return {
    messages,
    tasks: (tasksResult.data ?? []) as BuildContextParams["tasks"],
    memory: (memoryResult.data ?? []) as BuildContextParams["memory"],
    approvals: (approvalsResult.data ?? []) as BuildContextParams["approvals"],
    workLogs: ((logsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      action: String(row.action),
      summary: String(row.summary ?? ""),
    })),
    employees: ((employeesResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      role: String(row.role),
    })),
    sourceMessageIds: messages.map((m) => m.id),
    sourceWorkLogIds: ((logsResult.data ?? []) as Record<string, unknown>[]).map((row) =>
      String(row.id),
    ),
  };
}
