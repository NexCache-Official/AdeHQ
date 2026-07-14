import { generateObject } from "ai";
import { z } from "zod";
import { SILICONFLOW_CHEAP_MODEL, isSiliconFlowConfigured } from "@/lib/config/features";
import { getOutputTokenCap, getTimeoutMs, resolveModel } from "@/lib/ai/model-catalog";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isGeneralTopic } from "@/lib/topics";
import {
  buildContextSummaryFromMessages,
  selectMessagesForTopicImport,
  type TopicImportMessage,
} from "@/lib/topics/context-imports";
import type { RoomTopic } from "@/lib/types";
import type { OrchestrationIntent, OrchestratorInput, TopicStewardSuggestion } from "./types";

const SKIP_INTENTS: OrchestrationIntent[] = [
  "silent_note",
  "social_broadcast",
  "social_ack",
  "answer_to_pending_question",
];

const TopicStewardLlmSchema = z.object({
  deservesSeparateTopic: z.boolean(),
  confidence: z.number().min(0).max(1),
  title: z.string().max(80).optional(),
  description: z.string().max(280).optional(),
  reason: z.string().max(320).optional(),
  contextSummary: z.string().max(420).optional(),
  previewBullets: z.array(z.string().max(80)).max(4).optional(),
  relevantMessageIds: z.array(z.string()).max(12).optional(),
  existingTopicId: z.string().nullable().optional(),
});

const TOPIC_STEWARD_SYSTEM = `You are AdeHQ's topic steward. Decide whether the latest conversation deserves its own dedicated topic (workstream), and if so write an accurate title and description.

Only suggest a separate topic when ALL of these are true:
1. There is a focused workstream with enough substance (decisions, research, planning, deliverables) — not greetings, tiny clarifications, or one-off questions.
2. The current topic is too broad (often "General") OR the thread has clearly drifted into a different subject that should be tracked separately.
3. Creating a topic will help the team continue that work without cluttering the parent conversation.

Do NOT suggest when:
- The chat is casual / social / acknowledgment-only
- The work already lives in a well-scoped existing topic that matches
- There is not enough detail yet to name the workstream honestly
- You would only be guessing a vague title like "Project Discussion" or "Follow Up"

When deservesSeparateTopic is true:
- title: specific, accurate, 2–6 words reflecting the ACTUAL subject (never keyword spam or generic labels)
- description: one clear sentence of what this topic is for
- reason: short human explanation of why a separate topic helps
- contextSummary: 1–2 sentences of what to carry over
- previewBullets: 1–3 short labels of what will move (e.g. "pricing options", "open questions")
- relevantMessageIds: only message ids from the provided list that are relevant to this workstream (include the latest user message when relevant)
- existingTopicId: set when an existing non-General topic already covers this work (then deservesSeparateTopic must be false)

When deservesSeparateTopic is false, leave title/description empty and set confidence to how sure you are that no new topic is needed.`;

function toImportMessages(
  messages: OrchestratorInput["recentMessages"],
): TopicImportMessage[] {
  return messages.map((message) => ({
    id: message.id,
    senderType: message.senderType,
    senderId: message.senderId ?? undefined,
    senderName:
      message.senderType === "human"
        ? "Human"
        : message.senderType === "ai"
          ? "AI"
          : "System",
    content: message.text,
    createdAt: message.createdAt,
    topicId: message.topicId ?? undefined,
  }));
}

function shouldEvaluate(
  input: OrchestratorInput,
  intent: OrchestrationIntent,
): boolean {
  if (input.isDm || input.isMayaHiringSession) return false;
  if (SKIP_INTENTS.includes(intent)) return false;
  const text = input.messageText.trim();
  if (!text || text.length < 24) return false;

  const recentInTopic = input.recentMessages.filter(
    (m) => !input.topicId || m.topicId === input.topicId,
  );
  const humanTurns = recentInTopic.filter((m) => m.senderType === "human").length;
  // Need some back-and-forth or a substantive ask before suggesting a split.
  if (humanTurns < 2 && text.length < 80) return false;
  return true;
}

function buildFallbackSuggestion(
  input: OrchestratorInput,
  topic?: Pick<RoomTopic, "title" | "metadata">,
): TopicStewardSuggestion[] {
  // Without an LLM we refuse to invent inaccurate titles.
  void input;
  void topic;
  return [];
}

function resolveMessageIds(
  input: OrchestratorInput,
  llmIds: string[] | undefined,
  title: string,
): string[] {
  const recentInTopic = input.recentMessages.filter(
    (m) => !input.topicId || m.topicId === input.topicId,
  );
  const known = new Set(recentInTopic.map((m) => m.id));
  known.add(input.messageId);

  const fromLlm = (llmIds ?? []).filter((id) => known.has(id));
  if (fromLlm.length >= 2) {
    if (!fromLlm.includes(input.messageId)) fromLlm.push(input.messageId);
    return [...new Set(fromLlm)].slice(-12);
  }

  const selected = selectMessagesForTopicImport({
    messages: toImportMessages(recentInTopic),
    triggerMessageId: input.messageId,
    suggestedTopicTitle: title,
    maxMessages: 8,
  });
  const ids = selected.map((m) => m.id);
  if (!ids.includes(input.messageId)) ids.push(input.messageId);
  return [...new Set(ids)];
}

export async function suggestTopics(
  input: OrchestratorInput,
  intent: OrchestrationIntent,
  topic?: Pick<RoomTopic, "title" | "metadata">,
): Promise<TopicStewardSuggestion[]> {
  if (!shouldEvaluate(input, intent)) return [];

  const onGeneral = topic ? isGeneralTopic(topic as RoomTopic) : true;
  const recentInTopic = input.recentMessages
    .filter((m) => !input.topicId || m.topicId === input.topicId)
    .slice(-16);

  if (!isSiliconFlowConfigured()) {
    return buildFallbackSuggestion(input, topic);
  }

  const existingTopics = input.existingTopics
    .filter((t) => t.title.toLowerCase() !== "general")
    .slice(0, 12)
    .map((t) => `- ${t.id}: ${t.title}${t.summary ? ` — ${t.summary.slice(0, 120)}` : ""}`)
    .join("\n");

  const transcript = recentInTopic
    .map((m) => `[${m.id}] ${m.senderType}: ${m.text.slice(0, 400)}`)
    .join("\n");

  const model = resolveModel("siliconflow", "cheap", SILICONFLOW_CHEAP_MODEL);

  try {
    const { object } = await generateObject({
      model: siliconFlowChatModel(model),
      schema: TopicStewardLlmSchema,
      system: TOPIC_STEWARD_SYSTEM,
      prompt: [
        `Current topic: ${topic?.title ?? "General"}${onGeneral ? " (broad / General)" : ""}`,
        `Latest user message id: ${input.messageId}`,
        `Latest user message: ${input.messageText.trim().slice(0, 800)}`,
        "",
        "Existing topics in this room:",
        existingTopics || "(none besides General)",
        "",
        "Recent messages in the current topic (use these ids only):",
        transcript || "(none)",
      ].join("\n"),
      maxOutputTokens: getOutputTokenCap("cheap"),
      abortSignal: AbortSignal.timeout(getTimeoutMs("cheap")),
      providerOptions: siliconFlowProviderOptions(model),
    });

    const decision = TopicStewardLlmSchema.parse(object);

    if (decision.existingTopicId) {
      const match = input.existingTopics.find((t) => t.id === decision.existingTopicId);
      if (match && match.title.toLowerCase() !== "general") {
        return [
          {
            type: "move_to_existing_topic",
            topicId: match.id,
            topicTitle: match.title,
            reason:
              decision.reason?.trim() ||
              `This continues the work already tracked in "${match.title}".`,
            confidence: Math.min(0.95, Math.max(0.55, decision.confidence)),
            messageIds: resolveMessageIds(input, decision.relevantMessageIds, match.title),
          },
        ];
      }
    }

    if (!decision.deservesSeparateTopic) return [];
    if (decision.confidence < 0.72) return [];

    const title = decision.title?.trim();
    if (!title || title.length < 3) return [];
    if (/^(project|follow.?up|discussion|general|workstream|misc)\b/i.test(title)) {
      return [];
    }

    const messageIds = resolveMessageIds(input, decision.relevantMessageIds, title);
    const selected = toImportMessages(recentInTopic).filter((m) => messageIds.includes(m.id));
    const { summary } = buildContextSummaryFromMessages(selected, title);

    return [
      {
        type: "create_topic",
        title,
        description:
          decision.description?.trim() ||
          `Focused workstream for ${title}.`,
        reason:
          decision.reason?.trim() ||
          (onGeneral
            ? "This looks like a focused workstream that deserves its own topic so the team can continue it cleanly."
            : "This thread has enough detail to split into its own topic."),
        confidence: Math.min(0.96, Math.max(0.72, decision.confidence)),
        messageIds,
        contextSummary: decision.contextSummary?.trim() || summary,
        sourceScope: onGeneral ? "room" : "topic",
        previewBullets: (decision.previewBullets ?? []).map((b) => b.trim()).filter(Boolean).slice(0, 4),
        triggerMessageId: input.messageId,
        migrateMessages: true,
      },
    ];
  } catch (error) {
    console.warn("[AdeHQ topic-steward] LLM evaluation failed", error);
    return buildFallbackSuggestion(input, topic);
  }
}

/** @deprecated Prefer async suggestTopics — kept for sync callers/tests. */
export function suggestTopicsSync(
  input: OrchestratorInput,
  intent: OrchestrationIntent,
  topic?: Pick<RoomTopic, "title" | "metadata">,
): TopicStewardSuggestion[] {
  if (!shouldEvaluate(input, intent)) return [];
  return buildFallbackSuggestion(input, topic);
}
