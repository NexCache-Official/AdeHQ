import type { AiParticipationMode, RoomTopic, TopicMember, RoomMessage } from "@/lib/types";

export type TopicFilter = "active" | "mine" | "ai_running" | "approvals" | "archived";

export function topicsForRoom(topics: RoomTopic[], roomId: string): RoomTopic[] {
  return topics.filter((t) => t.roomId === roomId);
}

export function sortTopics(topics: RoomTopic[]): RoomTopic[] {
  return [...topics].sort((a, b) => {
    const aGeneral = isGeneralTopic(a) ? 1 : 0;
    const bGeneral = isGeneralTopic(b) ? 1 : 0;
    if (aGeneral !== bGeneral) return bGeneral - aGeneral;

    const aRunning = a.agentRunCount > 0 ? 1 : 0;
    const bRunning = b.agentRunCount > 0 ? 1 : 0;
    if (aRunning !== bRunning) return bRunning - aRunning;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });
}

export function filterTopics(
  topics: RoomTopic[],
  filter: TopicFilter,
  userId?: string,
  topicMembers?: TopicMember[],
): RoomTopic[] {
  switch (filter) {
    case "archived":
      return topics.filter((t) => t.status === "archived");
    case "active":
      return topics.filter((t) => t.status !== "archived");
    case "mine":
      if (!userId || !topicMembers) return topics;
      return topics.filter((t) =>
        topicMembers.some(
          (m) => m.topicId === t.id && m.memberType === "human" && m.memberId === userId,
        ),
      );
    case "ai_running":
      return topics.filter((t) => t.agentRunCount > 0);
    case "approvals":
      return topics.filter((t) => t.approvalCount > 0);
    default:
      return topics;
  }
}

export function topicUnreadCount(
  topic: RoomTopic,
  messages: RoomMessage[],
  member?: TopicMember,
): number {
  if (!member?.lastReadMessageId) {
    return messages.filter((m) => m.topicId === topic.id).length;
  }
  const lastReadIdx = messages.findIndex((m) => m.id === member.lastReadMessageId);
  if (lastReadIdx === -1) {
    return messages.filter((m) => m.topicId === topic.id).length;
  }
  return messages.filter((m) => m.topicId === topic.id).slice(lastReadIdx + 1).length;
}

export function isGeneralTopic(topic: RoomTopic): boolean {
  return topic.title.toLowerCase() === "general" || Boolean(topic.metadata?.isMainChat);
}

export function generalTopicForRoom(topics: RoomTopic[], roomId: string): RoomTopic | undefined {
  return topics.find((t) => t.roomId === roomId && isGeneralTopic(t));
}

export function nonGeneralTopics(topics: RoomTopic[], roomId: string): RoomTopic[] {
  return topicsForRoom(topics, roomId).filter((t) => !isGeneralTopic(t));
}

export function mainChatLabel(isDm: boolean): string {
  return isDm ? "Direct Chat" : "General Chat";
}

export function getAiParticipationMode(topic: RoomTopic): AiParticipationMode {
  const mode = topic.metadata?.aiParticipationMode;
  if (mode === "smart_assist" || mode === "active_team") return mode;
  return "manual_only";
}

export const TOPIC_TEMPLATES = [
  {
    id: "engineering",
    label: "Engineering implementation",
    description: "Track implementation work, migrations, and technical decisions.",
    suggestedRoles: ["engineering"] as const,
  },
  {
    id: "research",
    label: "Research investigation",
    description: "Gather findings, compare options, and document recommendations.",
    suggestedRoles: ["research"] as const,
  },
  {
    id: "product",
    label: "Product planning",
    description: "Define scope, milestones, and cross-functional alignment.",
    suggestedRoles: ["pm"] as const,
  },
  {
    id: "bugs",
    label: "Bug triage",
    description: "Reproduce issues, prioritize fixes, and verify resolutions.",
    suggestedRoles: ["engineering", "pm"] as const,
  },
  {
    id: "launch",
    label: "Launch strategy",
    description: "Coordinate go-to-market, messaging, and launch checklist.",
    suggestedRoles: ["pm", "marketing"] as const,
  },
  {
    id: "design",
    label: "Design review",
    description: "Review UX flows, visuals, and design system decisions.",
    suggestedRoles: ["design"] as const,
  },
  {
    id: "support",
    label: "Customer support",
    description: "Handle user issues, escalations, and support playbooks.",
    suggestedRoles: ["support"] as const,
  },
  {
    id: "devops",
    label: "DevOps incident",
    description: "Investigate incidents, mitigation, and postmortems.",
    suggestedRoles: ["engineering", "operations"] as const,
  },
  {
    id: "funding",
    label: "Funding/documentation",
    description: "Prepare docs, decks, and diligence materials.",
    suggestedRoles: ["pm", "research"] as const,
  },
  {
    id: "custom",
    label: "Custom",
    description: "",
    suggestedRoles: [] as const,
  },
] as const;
