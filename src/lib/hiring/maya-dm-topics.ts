import { MAYA_EMPLOYEE_ID } from "@/lib/hiring/maya";
import { authHeaders } from "@/lib/api/auth-client";
import { hiringTopicTitle } from "@/lib/topics";
import { uniqueHiringTopicTitle } from "@/lib/hiring/hiring-topic-utils";
import type { RoomTopic } from "@/lib/types";
import { uid, nowISO } from "@/lib/utils";

export async function createMayaHiringTopic(params: {
  roomId: string;
  workspaceId: string;
  userId?: string;
  roleTitle: string;
  roleKey?: string | null;
  backend: "demo" | "supabase";
  upsertTopic: (topic: RoomTopic) => void;
  existingTopics?: RoomTopic[];
  forceNewTitle?: boolean;
}): Promise<RoomTopic> {
  const title = params.forceNewTitle
    ? uniqueHiringTopicTitle(params.roleTitle, params.existingTopics ?? [])
    : hiringTopicTitle(params.roleTitle);
  const metadata = {
    hiringSession: true,
    roleKey: params.roleKey ?? null,
    roleTitle: params.roleTitle,
  };

  if (params.backend === "supabase") {
    const headers = await authHeaders();
    const response = await fetch(`/api/rooms/${params.roomId}/topics`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title,
        description: `Hiring session for ${params.roleTitle}`,
        priority: "normal",
        metadata,
        aiEmployeeIds: [MAYA_EMPLOYEE_ID],
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(err?.error ?? "Could not create hiring topic.");
    }
    const { topic } = await response.json();
    params.upsertTopic(topic as RoomTopic);
    return topic as RoomTopic;
  }

  const timestamp = nowISO();
  const topic: RoomTopic = {
    id: uid("topic"),
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    title,
    description: `Hiring session for ${params.roleTitle}`,
    status: "active",
    priority: "normal",
    createdByType: "human",
    createdById: params.userId,
    lastActivityAt: timestamp,
    messageCount: 0,
    taskCount: 0,
    openTaskCount: 0,
    memoryCount: 0,
    approvalCount: 0,
    agentRunCount: 0,
    metadata,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  params.upsertTopic(topic);
  return topic;
}

export async function updateMayaHiringTopic(params: {
  topicId: string;
  roleTitle: string;
  roleKey?: string | null;
  backend: "demo" | "supabase";
  upsertTopic: (topic: RoomTopic) => void;
  currentTopic: RoomTopic;
}): Promise<RoomTopic> {
  const title = hiringTopicTitle(params.roleTitle);
  const metadata = {
    ...(params.currentTopic.metadata ?? {}),
    hiringSession: true,
    roleKey: params.roleKey ?? null,
    roleTitle: params.roleTitle,
  };

  if (params.backend === "supabase") {
    const headers = await authHeaders();
    const response = await fetch(`/api/topics/${params.topicId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title, metadata }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(err?.error ?? "Could not update hiring topic.");
    }
    const { topic } = await response.json();
    params.upsertTopic(topic as RoomTopic);
    return topic as RoomTopic;
  }

  const updated: RoomTopic = {
    ...params.currentTopic,
    title,
    metadata,
    updatedAt: nowISO(),
  };
  params.upsertTopic(updated);
  return updated;
}
