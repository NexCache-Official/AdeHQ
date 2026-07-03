export type JumpSourceType =
  | "message"
  | "topic"
  | "room"
  | "file"
  | "artifact"
  | "work_log"
  | "memory"
  | "task"
  | "approval";

export type JumpSource = {
  type: JumpSourceType;
  roomId?: string;
  topicId?: string;
  messageId?: string;
  entityId?: string;
  label?: string;
};

export const JUMP_TO_SOURCE_EVENT = "adehq:jump-to-source";
export const SCROLL_TO_MESSAGE_EVENT = "adehq:scroll-to-message";

export function jumpToSource(source: JumpSource): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(JUMP_TO_SOURCE_EVENT, { detail: source }));
}

export function requestScrollToMessage(messageId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SCROLL_TO_MESSAGE_EVENT, { detail: { messageId } }));
}

export function jumpToMessage(params: {
  roomId: string;
  topicId?: string;
  messageId: string;
}): void {
  jumpToSource({
    type: "message",
    roomId: params.roomId,
    topicId: params.topicId,
    messageId: params.messageId,
  });
}

export function jumpFromWorkLog(event: {
  roomId: string;
  topicId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}): void {
  if (event.relatedEntityType === "message" && event.relatedEntityId) {
    jumpToMessage({
      roomId: event.roomId,
      topicId: event.topicId,
      messageId: event.relatedEntityId,
    });
    return;
  }
  if (event.topicId) {
    jumpToSource({ type: "topic", roomId: event.roomId, topicId: event.topicId });
    return;
  }
  jumpToSource({ type: "room", roomId: event.roomId });
}

export function jumpFromMemory(entry: {
  roomId: string;
  topicId?: string;
  sourceMessageId?: string;
  sourceType?: string;
}): void {
  if (entry.sourceMessageId) {
    jumpToMessage({
      roomId: entry.roomId,
      topicId: entry.topicId,
      messageId: entry.sourceMessageId,
    });
    return;
  }
  if (entry.topicId) {
    jumpToSource({ type: "topic", roomId: entry.roomId, topicId: entry.topicId });
    return;
  }
  jumpToSource({ type: "room", roomId: entry.roomId });
}
