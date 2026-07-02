import type { ProjectRoom } from "@/lib/types";

/** Group collaboration room (multi-member). Not a 1:1 DM. */
export function isGroupRoom(room: ProjectRoom): boolean {
  return room.kind !== "dm";
}

/** Private 1:1 conversation with a single AI employee. */
export function isDirectMessage(room: ProjectRoom): boolean {
  return room.kind === "dm";
}

export function getGroupRooms(rooms: ProjectRoom[]): ProjectRoom[] {
  return rooms.filter((r) => isGroupRoom(r) && (r.status ?? "active") !== "archived");
}

export function getArchivedGroupRooms(rooms: ProjectRoom[]): ProjectRoom[] {
  return rooms.filter((r) => isGroupRoom(r) && r.status === "archived");
}

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
