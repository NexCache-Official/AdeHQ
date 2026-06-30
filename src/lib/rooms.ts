import type { ProjectRoom } from "@/lib/types";

/** Group collaboration space (multi-member channel). Not a 1:1 DM. */
export function isGroupChannel(room: ProjectRoom): boolean {
  return room.kind !== "dm";
}

/** Private 1:1 conversation with a single AI employee. */
export function isDirectMessage(room: ProjectRoom): boolean {
  return room.kind === "dm";
}

export function getGroupChannels(rooms: ProjectRoom[]): ProjectRoom[] {
  return rooms.filter(isGroupChannel);
}

export function getDirectMessages(rooms: ProjectRoom[]): ProjectRoom[] {
  return rooms.filter(isDirectMessage);
}
