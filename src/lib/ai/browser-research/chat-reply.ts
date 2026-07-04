import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeReplyForChat } from "@/lib/ai/normalize-model-response";
import { generateText, planRoute } from "@/lib/ai/runtime";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";
import { refreshTopicStats } from "@/lib/server/topic-stats";
import type { AIEmployee, RoomMessage } from "@/lib/types";
import { nowISO, uid } from "@/lib/utils";
import type { BrowserResearchProviderResult } from "./provider-result";
import type { BrowserResearchMockSource, BrowserResearchProvider, BrowserResearchRun } from "./types";

type ChatReplyInput = {
  query: string;
  findings: BrowserResearchProviderResult["findings"];
  mockSources: BrowserResearchMockSource[];
  provider: BrowserResearchProvider;
  workspaceId: string;
  employeeId: string;
  employeeName: string;
};

function buildTemplateChatReply(input: ChatReplyInput): string {
  const lines: string[] = [];

  if (input.findings.length > 0) {
    lines.push("Here's what I found:");
    lines.push("");
    for (const finding of input.findings.slice(0, 4)) {
      lines.push(`**${finding.title}** — ${finding.summary}`);
    }
  } else {
    lines.push("I couldn't find solid results for that question.");
  }

  if (input.mockSources.length > 0) {
    lines.push("", "**Sources**");
    for (const source of input.mockSources.slice(0, 5)) {
      lines.push(`- [${source.title}](${source.url})`);
    }
  }

  if (input.provider === "mock") {
    lines.push(
      "",
      "_Live research isn't configured in this workspace yet, so these results are placeholders._",
    );
  }

  return lines.join("\n");
}

async function synthesizeChatReply(
  input: ChatReplyInput,
): Promise<{ text?: string; costUsd: number; workMinutes: number }> {
  const flags = getRuntimeFlags();
  const forceMode = flags.mode === "on" ? undefined : ("shadow" as const);
  const prompt = [
    `The user asked: ${input.query}`,
    "",
    "Findings:",
    ...input.findings.map((finding) => `- ${finding.title}: ${finding.summary}`),
    "",
    "Sources:",
    ...input.mockSources.map((source) => `- ${source.title} (${source.url}): ${source.note}`),
  ].join("\n");

  const fallbackPlan = planRoute({
    capability: "summarization",
    workspaceId: input.workspaceId,
    employeeId: input.employeeId,
    message: input.query,
  });

  try {
    const result = await generateText(
      {
        capability: "summarization",
        workspaceId: input.workspaceId,
        employeeId: input.employeeId,
        runtimeMode: "balanced",
        system: [
          `You are ${input.employeeName}, an AI employee in a team chat.`,
          "The user asked you to research something on the web.",
          "Write a concise, friendly reply explaining what you found, like ChatGPT would.",
          "Cite sources inline as markdown links. Do not invent URLs.",
          "Use 2-4 short paragraphs. Lead with the direct answer when possible.",
        ].join(" "),
        prompt,
        maxTokens: 900,
      },
      { forceMode },
    );

    const costUsd =
      result.usage?.totalCostUsd ??
      result.routing?.estimatedCostUsd ??
      fallbackPlan.estimatedCostUsd;
    const workMinutes =
      result.workMinutesEstimated ??
      estimateWorkMinutesFromCost(costUsd) ??
      fallbackPlan.estimatedWorkMinutes;

    if (result.text?.trim() && !result.shadow) {
      return { text: result.text.trim(), costUsd, workMinutes };
    }

    return { costUsd, workMinutes };
  } catch (error) {
    console.warn("[AdeHQ browser research chat reply]", error);
    return {
      costUsd: fallbackPlan.estimatedCostUsd,
      workMinutes: fallbackPlan.estimatedWorkMinutes,
    };
  }
}

/** Post a conversational AI message summarizing completed browser research. */
export async function persistBrowserResearchChatReply(
  client: SupabaseClient,
  run: BrowserResearchRun,
  result: BrowserResearchProviderResult,
  employee: AIEmployee,
): Promise<RoomMessage | null> {
  if (!run.roomId || !run.topicId) return null;

  const synthesis = await synthesizeChatReply({
    query: run.query,
    findings: result.findings,
    mockSources: result.mockSources,
    provider: result.provider,
    workspaceId: run.workspaceId,
    employeeId: run.employeeId,
    employeeName: employee.name,
  });

  const content = sanitizeReplyForChat(
    synthesis.text ?? buildTemplateChatReply({
      query: run.query,
      findings: result.findings,
      mockSources: result.mockSources,
      provider: result.provider,
      workspaceId: run.workspaceId,
      employeeId: run.employeeId,
      employeeName: employee.name,
    }),
  );

  const aiMessage: RoomMessage = {
    id: uid("msg"),
    roomId: run.roomId,
    topicId: run.topicId,
    senderType: "ai",
    senderId: employee.id,
    senderName: employee.name,
    content,
    createdAt: nowISO(),
  };

  const { error: messageError } = await client.from("messages").insert({
    workspace_id: run.workspaceId,
    id: aiMessage.id,
    room_id: run.roomId,
    topic_id: run.topicId,
    sender_type: aiMessage.senderType,
    sender_id: aiMessage.senderId,
    sender_name: aiMessage.senderName,
    content: aiMessage.content,
    mentions: [],
    mentions_json: [],
    agent_run_id: run.workUnitId ?? null,
    pending: false,
    created_at: aiMessage.createdAt,
  });
  if (messageError) throw messageError;

  await client
    .from("ai_employees")
    .update({
      status: "idle",
      messages_sent: (employee.messagesSent ?? 0) + 1,
      last_active_at: nowISO(),
    })
    .eq("workspace_id", run.workspaceId)
    .eq("id", employee.id);

  void refreshTopicStats(client, run.topicId).catch((err) => {
    console.error("[AdeHQ] topic stats refresh failed", err);
  });

  return aiMessage;
}
