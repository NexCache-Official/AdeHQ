import type { ProjectRoom } from "@/lib/types";
import { getGroupRooms } from "@/lib/rooms";

/** Group room names must be unique per workspace; append " 2", " 3", … when needed. */
export function resolveUniqueRoomName(rooms: ProjectRoom[], baseName: string): string {
  const normalized = baseName.trim();
  if (!normalized) return normalized;

  const taken = new Set(
    getGroupRooms(rooms).map((r) => r.name.trim().toLowerCase()),
  );
  if (!taken.has(normalized.toLowerCase())) return normalized;

  let suffix = 2;
  while (taken.has(`${normalized} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${normalized} ${suffix}`;
}
