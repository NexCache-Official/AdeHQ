import type { ProjectRoom, RoomTopic, TopicMember } from "@/lib/types";
import { isGeneralTopic } from "@/lib/topics";
import { nowISO } from "@/lib/utils";

export function dmGeneralTopicId(roomId: string): string {
  return `topic-general-${roomId}`;
}

export function buildDmGeneralTopic(
  workspaceId: string,
  roomId: string,
  timestamp: string,
  messageCount = 1,
): RoomTopic {
  return {
    id: dmGeneralTopicId(roomId),
    workspaceId,
    roomId,
    title: "General",
    description: "Default topic for existing room messages.",
    status: "active",
    priority: "normal",
    createdByType: "system",
    lastMessageAt: timestamp,
    lastActivityAt: timestamp,
    messageCount,
    taskCount: 0,
    openTaskCount: 0,
    memoryCount: 0,
    approvalCount: 0,
    agentRunCount: 0,
    metadata: { isMainChat: true, aiParticipationMode: "smart_assist_lite" },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function buildDmGeneralTopicMembers(
  workspaceId: string,
  roomId: string,
  topicId: string,
  userId: string,
  employeeId: string | undefined,
  timestamp: string,
): TopicMember[] {
  const members: TopicMember[] = [
    {
      id: `tm-${roomId}-human`,
      workspaceId,
      roomId,
      topicId,
      memberType: "human",
      memberId: userId,
      role: "owner",
      notificationLevel: "normal",
      createdAt: timestamp,
    },
  ];
  if (employeeId) {
    members.push({
      id: `tm-${roomId}-${employeeId}`,
      workspaceId,
      roomId,
      topicId,
      memberType: "ai",
      memberId: employeeId,
      role: "participant",
      notificationLevel: "normal",
      createdAt: timestamp,
    });
  }
  return members;
}

/** Ensure a DM has a General topic in local state; return topic id. */
export function ensureDmGeneralTopicInState<
  T extends {
    workspace?: { id: string };
    rooms: ProjectRoom[];
    topics?: RoomTopic[];
    topicMembers?: TopicMember[];
  },
>(
  state: T,
  roomId: string,
  userId: string,
  employeeId?: string,
): { state: T; topicId: string } {
  const room = state.rooms.find((entry) => entry.id === roomId);
  if (!room) {
    return { state, topicId: dmGeneralTopicId(roomId) };
  }

  const roomTopics = (state.topics ?? []).filter((topic) => topic.roomId === roomId);
  const existing =
    roomTopics.find((topic) => isGeneralTopic(topic)) ??
    roomTopics.find((topic) => topic.title.toLowerCase() === "general");

  if (existing) {
    const needsSync = room.messages.some((message) => message.topicId !== existing.id);
    if (!needsSync) return { state, topicId: existing.id };
    return {
      topicId: existing.id,
      state: {
        ...state,
        rooms: state.rooms.map((entry) =>
          entry.id === roomId
            ? {
                ...entry,
                messages: entry.messages.map((message) =>
                  message.topicId === existing.id
                    ? message
                    : { ...message, topicId: existing.id },
                ),
              }
            : entry,
        ),
      },
    };
  }

  if (roomTopics.length > 0) {
    return { state, topicId: roomTopics[0]!.id };
  }

  const timestamp = nowISO();
  const workspaceId = state.workspace?.id || "local";
  const topic = buildDmGeneralTopic(workspaceId, roomId, timestamp, room.messages.length || 1);
  const members = buildDmGeneralTopicMembers(
    workspaceId,
    roomId,
    topic.id,
    userId,
    employeeId,
    timestamp,
  );

  return {
    topicId: topic.id,
    state: {
      ...state,
      topics: [topic, ...(state.topics ?? [])],
      topicMembers: [...members, ...(state.topicMembers ?? [])],
      rooms: state.rooms.map((entry) =>
        entry.id === roomId
          ? {
              ...entry,
              messages: entry.messages.map((message) =>
                message.topicId ? message : { ...message, topicId: topic.id },
              ),
            }
          : entry,
      ),
    },
  };
}
