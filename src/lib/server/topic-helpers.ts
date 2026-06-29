import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoomTopic, TopicMember, TopicPriority, TopicStatus } from "@/lib/types";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

export function topicFromRow(row: DbRow): RoomTopic {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: String(row.room_id),
    title: String(row.title),
    slug: row.slug ? String(row.slug) : null,
    description: row.description ? String(row.description) : null,
    status: row.status as TopicStatus,
    priority: row.priority as TopicPriority,
    createdByType: row.created_by_type as RoomTopic["createdByType"],
    createdById: row.created_by_id ? String(row.created_by_id) : null,
    summary: row.summary ? String(row.summary) : null,
    pinnedSummary: row.pinned_summary ? String(row.pinned_summary) : null,
    lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
    lastActivityAt: String(row.last_activity_at ?? row.created_at ?? nowISO()),
    messageCount: Number(row.message_count ?? 0),
    taskCount: Number(row.task_count ?? 0),
    openTaskCount: Number(row.open_task_count ?? 0),
    memoryCount: Number(row.memory_count ?? 0),
    approvalCount: Number(row.approval_count ?? 0),
    agentRunCount: Number(row.agent_run_count ?? 0),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at ?? nowISO()),
    updatedAt: String(row.updated_at ?? row.created_at ?? nowISO()),
  };
}

export function topicMemberFromRow(row: DbRow): TopicMember {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: String(row.room_id),
    topicId: String(row.topic_id),
    memberType: row.member_type as TopicMember["memberType"],
    memberId: String(row.member_id),
    role: row.role as TopicMember["role"],
    notificationLevel: row.notification_level as TopicMember["notificationLevel"],
    lastReadMessageId: row.last_read_message_id ? String(row.last_read_message_id) : null,
    lastReadAt: row.last_read_at ? String(row.last_read_at) : null,
    createdAt: String(row.created_at ?? nowISO()),
  };
}

export async function getTopicForRoom(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
): Promise<RoomTopic | null> {
  const { data, error } = await client
    .from("room_topics")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("room_id", roomId)
    .eq("id", topicId)
    .maybeSingle();
  if (error) throw error;
  return data ? topicFromRow(data as DbRow) : null;
}

export async function assertTopicInRoom(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
): Promise<RoomTopic> {
  const topic = await getTopicForRoom(client, workspaceId, roomId, topicId);
  if (!topic) {
    throw new Error("Topic not found in this room.");
  }
  if (topic.status === "archived") {
    throw new Error("This topic is archived.");
  }
  return topic;
}

export async function ensureGeneralTopic(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<RoomTopic> {
  const { data: existing, error: findError } = await client
    .from("room_topics")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("room_id", roomId)
    .ilike("title", "general")
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return topicFromRow(existing as DbRow);

  const { data: created, error: createError } = await client
    .from("room_topics")
    .insert({
      workspace_id: workspaceId,
      room_id: roomId,
      title: "General",
      description: "Default topic for existing room messages.",
      created_by_type: "system",
    })
    .select("*")
    .single();
  if (createError) throw createError;
  return topicFromRow(created as DbRow);
}

export function slugifyTopicTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}
