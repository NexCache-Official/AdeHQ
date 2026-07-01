import type { MessageSeenBy, RoomMessage, TopicMember, WorkspaceMember } from "@/lib/types";

/** Merge persisted human read cursors into human-sent message seenBy. */
export function enrichHumanSeenBy(
  message: RoomMessage,
  topicMessages: RoomMessage[],
  topicMembers: TopicMember[],
  workspaceMembers: WorkspaceMember[],
): MessageSeenBy[] {
  const base = [...(message.seenBy ?? [])];
  if (message.senderType !== "human") return base;

  const msgIdx = topicMessages.findIndex((m) => m.id === message.id);
  if (msgIdx < 0) return base;

  for (const member of topicMembers) {
    if (member.memberType !== "human" || member.memberId === message.senderId) continue;
    if (base.some((entry) => entry.id === member.memberId)) continue;

    const cursorIdx = member.lastReadMessageId
      ? topicMessages.findIndex((m) => m.id === member.lastReadMessageId)
      : -1;
    if (cursorIdx < msgIdx) continue;

    const name =
      workspaceMembers.find((w) => w.userId === member.memberId)?.name ?? "Teammate";
    base.push({ id: member.memberId, name, type: "human" });
  }

  return base;
}
