import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { topicFromRow } from "@/lib/server/topic-helpers";
import { siliconFlowChatModel } from "@/lib/ai/siliconflow-client";
import { resolveModel } from "@/lib/ai/model-catalog";
import { nowISO, uid } from "@/lib/utils";

export const runtime = "nodejs";

function cleanSummary(text: string): string {
  return text
    .trim()
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

export async function POST(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);

    const { data: topicRow, error: topicError } = await client
      .from("channel_topics")
      .select("*")
      .eq("id", params.topicId)
      .maybeSingle();
    if (topicError) throw topicError;
    if (!topicRow) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const topic = topicFromRow(topicRow);
    const { role } = await requireWorkspaceMembership(client, topic.workspaceId, user.id);
    await assertCanAccessRoom(client, topic.workspaceId, topic.roomId, user.id, role);

    const [messagesResult, tasksResult, memoryResult, approvalsResult, logsResult] =
      await Promise.all([
        client
          .from("messages")
          .select("sender_name, content, created_at")
          .eq("topic_id", params.topicId)
          .order("created_at", { ascending: false })
          .limit(40),
        client
          .from("tasks")
          .select("title, status, priority")
          .eq("topic_id", params.topicId)
          .limit(20),
        client
          .from("memory_entries")
          .select("title, content, status")
          .eq("topic_id", params.topicId)
          .limit(12),
        client
          .from("approvals")
          .select("title, status, risk")
          .eq("topic_id", params.topicId)
          .limit(10),
        client
          .from("work_log_events")
          .select("action, summary, status")
          .eq("topic_id", params.topicId)
          .order("created_at", { ascending: false })
          .limit(15),
      ]);

    const contextBlock = [
      `Topic: ${topic.title}`,
      topic.description ? `Description: ${topic.description}` : "",
      "",
      "Recent messages:",
      ...(messagesResult.data ?? [])
        .reverse()
        .map((m) => `[${m.sender_name}] ${m.content}`)
        .slice(-30),
      "",
      "Tasks:",
      ...(tasksResult.data ?? []).map((t) => `- [${t.status}] ${t.title}`),
      "",
      "Memory:",
      ...(memoryResult.data ?? []).map((m) => `- ${m.title}: ${String(m.content).slice(0, 200)}`),
      "",
      "Pending approvals:",
      ...(approvalsResult.data ?? [])
        .filter((a) => a.status === "pending")
        .map((a) => `- ${a.title} (${a.risk})`),
      "",
      "Recent work logs:",
      ...(logsResult.data ?? []).map((w) => `- ${w.action}: ${w.summary}`),
    ]
      .filter(Boolean)
      .join("\n");

    const model = siliconFlowChatModel(resolveModel("siliconflow", "balanced"));
    const { text } = await generateText({
      model,
      system: `You summarize AdeHQ work topics. Produce a concise plain-text summary with these labels and no Markdown heading markers:
What happened:
Current decision:
Open questions:
Next tasks:
Risks:
Stay focused only on this topic. Do not invent facts.`,
      prompt: contextBlock,
      maxOutputTokens: 1200,
    });

    const summary = cleanSummary(text);
    const { data: updated, error: updateError } = await client
      .from("channel_topics")
      .update({ summary, updated_at: nowISO() })
      .eq("id", params.topicId)
      .select("*")
      .single();
    if (updateError) throw updateError;

    const memoryId = uid("mem");
    await client.from("memory_entries").insert({
      workspace_id: topic.workspaceId,
      id: memoryId,
      channel_id: topic.roomId,
      topic_id: params.topicId,
      type: "general",
      title: `Topic summary: ${topic.title}`,
      content: summary,
      status: "draft",
      created_by_type: "system",
      created_by_id: "system",
      created_at: nowISO(),
    });

    return NextResponse.json({
      topic: topicFromRow(updated),
      summary,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic summarize]", error);
    return NextResponse.json({ error: "Unable to summarize topic." }, { status: 500 });
  }
}
