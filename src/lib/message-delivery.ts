import type { RoomMessage } from "@/lib/types";

/** Normalize DB / optimistic message into a consistent delivery state for human messages. */
export function normalizeHumanDelivery(message: RoomMessage): RoomMessage {
  if (message.senderType !== "human") return message;
  if (message.failed || message.deliveryStatus === "failed") {
    return { ...message, pending: false, deliveryStatus: "failed" };
  }
  if (message.pending || message.deliveryStatus === "sending") {
    return { ...message, pending: true, deliveryStatus: "sending" };
  }
  return {
    ...message,
    pending: false,
    deliveryStatus: message.deliveryStatus ?? "delivered",
    deliveredAt: message.deliveredAt ?? message.createdAt,
  };
}

/** Merge a remote message with local optimistic / client-only delivery fields. */
export function mergeChatMessage(previous: RoomMessage, remote: RoomMessage): RoomMessage {
  if (previous.id !== remote.id) return normalizeHumanDelivery(remote);

  const merged: RoomMessage = {
    ...remote,
    seenBy: remote.seenBy?.length ? remote.seenBy : previous.seenBy,
  };

  if (remote.senderType !== "human") return merged;

  const wasSending = previous.pending || previous.deliveryStatus === "sending";
  const remoteSaved = !remote.pending;

  if (wasSending && remoteSaved) {
    return normalizeHumanDelivery({
      ...merged,
      pending: false,
      deliveryStatus: "delivered",
      deliveredAt: previous.deliveredAt ?? remote.createdAt,
    });
  }

  if (previous.deliveryStatus === "delivered" || previous.pending === false) {
    return normalizeHumanDelivery({
      ...merged,
      pending: false,
      deliveryStatus: previous.deliveryStatus ?? "delivered",
      deliveredAt: previous.deliveredAt ?? remote.createdAt,
    });
  }

  return normalizeHumanDelivery({
    ...merged,
    deliveryStatus: previous.deliveryStatus ?? merged.deliveryStatus,
    deliveredAt: previous.deliveredAt ?? merged.deliveredAt,
    pending: previous.pending ?? merged.pending,
  });
}

/** Merge remote room messages with local state after Supabase realtime reloads. */
export function mergeRoomMessages(
  previous: RoomMessage[],
  remote: RoomMessage[],
): RoomMessage[] {
  const prevById = new Map(previous.map((message) => [message.id, message]));
  const seenClientIds = new Set<string>();
  const merged: RoomMessage[] = [];

  for (const remoteMsg of remote) {
    const clientId = remoteMsg.clientMessageId;
    if (clientId) {
      if (seenClientIds.has(clientId)) continue;
      seenClientIds.add(clientId);
    }

    const prevMsg =
      prevById.get(remoteMsg.id) ??
      (clientId
        ? previous.find((m) => m.clientMessageId === clientId)
        : undefined);
    merged.push(prevMsg ? mergeChatMessage(prevMsg, remoteMsg) : normalizeHumanDelivery(remoteMsg));
  }

  for (const prevMsg of previous) {
    if (remote.some((message) => message.id === prevMsg.id)) continue;
    if (prevMsg.clientMessageId && remote.some((m) => m.clientMessageId === prevMsg.clientMessageId)) {
      continue;
    }
    if (prevMsg.pending || prevMsg.deliveryStatus === "sending") {
      merged.push(prevMsg);
    }
  }

  return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
