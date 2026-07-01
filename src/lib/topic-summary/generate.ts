import { generateObject } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { siliconFlowChatModel } from "@/lib/ai/siliconflow-client";
import { resolveModel } from "@/lib/ai/model-catalog";
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
    }),
  ),
  suggestedMemory: z.array(
    z.object({
      text: z.string(),
      scope: z.enum(["workspace", "room", "topic", "employee"]),
      reason: z.string(),
      sourceMessageId: z.string().optional(),
    }),
  ),
  isCasualConversation: z.boolean().optional(),
});

export type GeneratedTopicSummaryPayload = z.infer<typeof summarySchema>;

type BuildContextParams = {
  topicTitle: string;
  topicDescription?: string | null;
  existing?: TopicSummary | null;
  messages: Array<{ id: string; senderName: string; content: string; createdAt: string }>;
  tasks: Array<{ title: string; status: string; priority: string }>;
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

export async function generateTopicSummaryPayload(
  contextBlock: string,
): Promise<GeneratedTopicSummaryPayload> {
  const model = siliconFlowChatModel(resolveModel("siliconflow", "balanced"));

  const { object } = await generateObject({
    model,
    schema: summarySchema,
    system: `You maintain durable workstream summaries for AdeHQ topics.
Return JSON only matching the schema.

Rules:
- Be concise and factual. Do not invent facts.
- Use "No decision yet" as currentDecision only when no decision was made; otherwise use null when unclear.
- openQuestions, keyFacts, nextActions, and suggestedMemory should be short bullet-quality items.
- Preserve sourceMessageId from message IDs in brackets when an item came from a specific message.
- suggestedMemory is a suggestion only — never imply it was saved.
- Set isCasualConversation true when the thread is only greetings, thanks, or small talk with no work substance.
- If casual, keep summary minimal and leave lists mostly empty.
- Distinguish facts, decisions, open questions, and next actions clearly.
- ownerEmployeeId must be an employee id from the context when assigning next actions.`,
    prompt: contextBlock,
    maxOutputTokens: 1400,
  });

  return object;
}

export async function loadTopicSummaryGenerationContext(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
  roomId: string,
) {
  const [messagesResult, tasksResult, memoryResult, approvalsResult, logsResult, employeesResult] =
    await Promise.all([
      client
        .from("messages")
        .select("id, sender_name, content, created_at")
        .eq("workspace_id", workspaceId)
        .eq("topic_id", topicId)
        .order("created_at", { ascending: false })
        .limit(40),
      client
        .from("tasks")
        .select("title, status, priority")
        .eq("workspace_id", workspaceId)
        .eq("topic_id", topicId)
        .limit(20),
      client
        .from("memory_entries")
        .select("title, content, status")
        .eq("workspace_id", workspaceId)
        .eq("topic_id", topicId)
        .limit(12),
      client
        .from("approvals")
        .select("title, status, risk")
        .eq("workspace_id", workspaceId)
        .eq("topic_id", topicId)
        .limit(10),
      client
        .from("work_log_events")
        .select("id, action, summary")
        .eq("workspace_id", workspaceId)
        .eq("topic_id", topicId)
        .order("created_at", { ascending: false })
        .limit(15),
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
