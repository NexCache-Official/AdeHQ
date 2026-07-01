import type { ProjectRoom } from "@/lib/types";

/** Group collaboration room (multi-member). Not a 1:1 DM. */
export function isGroupRoom(room: ProjectRoom): boolean {
  return room.kind !== "dm";
}

/** @deprecated Use isGroupRoom */
export const isGroupChannel = isGroupRoom;

/** Private 1:1 conversation with a single AI employee. */
export function isDirectMessage(room: ProjectRoom): boolean {
  return room.kind === "dm";
}

export function getGroupRooms(rooms: ProjectRoom[]): ProjectRoom[] {
  return rooms.filter((r) => isGroupRoom(r) && (r.status ?? "active") !== "archived");
}

/** @deprecated Use getGroupRooms */
export const getGroupChannels = getGroupRooms;

export function getArchivedGroupRooms(rooms: ProjectRoom[]): ProjectRoom[] {
  return rooms.filter((r) => isGroupRoom(r) && r.status === "archived");
}

/** @deprecated Use getArchivedGroupRooms */
export const getArchivedGroupChannels = getArchivedGroupRooms;

export function getDirectMessages(rooms: ProjectRoom[]): ProjectRoom[] {
  return rooms.filter(isDirectMessage);
}

/** Resolve the AI employee for a DM room. */
export function getDmEmployeeId(room: ProjectRoom): string | undefined {
  return room.dmEmployeeId ?? room.aiEmployees[0];
}

export function findDmRoomForEmployee(
  rooms: ProjectRoom[],
  employeeId: string,
): ProjectRoom | undefined {
  return rooms.find((r) => isDirectMessage(r) && getDmEmployeeId(r) === employeeId);
}
