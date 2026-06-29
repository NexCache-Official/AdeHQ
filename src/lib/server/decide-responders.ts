import type { AIEmployee, MentionRef, ProjectRoom, RoomTopic } from "@/lib/types";
import { getAiParticipationMode } from "@/lib/topics";
import { pickSmartResponders } from "@/lib/server/smart-participation";
import { extractMentions } from "@/lib/utils";

export type ResponderDecision = {
  employee: AIEmployee;
  reason: "mention" | "dm_default" | "smart_assist" | "slash_command";
};

export function decideResponders(
  content: string,
  topic: RoomTopic,
  room: ProjectRoom,
  employees: AIEmployee[],
  mentionsJson?: MentionRef[],
  options?: { forceEmployeeIds?: string[]; maxParallel?: number },
): ResponderDecision[] {
  const max = options?.maxParallel ?? 3;
  const participation = getAiParticipationMode(topic);
  const isDM = room.kind === "dm";

  if (options?.forceEmployeeIds?.length) {
    return employees
      .filter((e) => options.forceEmployeeIds!.includes(e.id))
      .slice(0, max)
      .map((employee) => ({ employee, reason: "slash_command" as const }));
  }

  let mentioned: AIEmployee[];
  if (mentionsJson?.length) {
    const ids = mentionsJson.filter((m) => m.type === "ai_employee").map((m) => m.id);
    mentioned = employees.filter((e) => ids.includes(e.id));
  } else {
    const ids = extractMentions(
      content,
      employees.map((e) => ({ id: e.id, name: e.name })),
    );
    mentioned = employees.filter((e) => ids.includes(e.id));
  }

  if (mentioned.length > 0) {
    return mentioned.slice(0, max).map((employee) => ({ employee, reason: "mention" }));
  }

  if (participation !== "manual_only") {
    const topicMemberIds = new Set(
      employees.map((e) => e.id),
    );
    const eligible = employees.filter((e) => topicMemberIds.has(e.id));
    const smart = pickSmartResponders(content, eligible, participation, max);
    if (smart.length) {
      return smart.map((employee) => ({ employee, reason: "smart_assist" }));
    }
  }

  // DMs: in manual_only, no auto-reply without mention
  if (isDM && participation === "manual_only") {
    return [];
  }

  return [];
}
