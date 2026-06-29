import type { AIEmployee, MentionRef, ProjectRoom, RoomTopic } from "@/lib/types";
import { getAiParticipationMode, isGeneralTopic } from "@/lib/topics";
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
  const mentionedIds = new Set<string>();

  if (mentionsJson?.length) {
    for (const m of mentionsJson) {
      if (m.type === "ai_employee") mentionedIds.add(m.id);
    }
  }
  for (const id of extractMentions(
    content,
    employees.map((e) => ({ id: e.id, name: e.name })),
  )) {
    mentionedIds.add(id);
  }
  mentioned = employees.filter((e) => mentionedIds.has(e.id));

  if (mentioned.length > 0) {
    return mentioned.slice(0, max).map((employee) => ({ employee, reason: "mention" }));
  }

  if (participation !== "manual_only") {
    const smart = pickSmartResponders(content, employees, participation, max);
    if (smart.length) {
      return smart.map((employee) => ({ employee, reason: "smart_assist" }));
    }
  }

  // DMs: the counterpart AI employee should always respond in Direct Chat.
  if (isDM && isGeneralTopic(topic)) {
    const dmEmployee =
      employees.find((e) => e.id === room.dmEmployeeId) ?? employees[0];
    if (dmEmployee) {
      return [{ employee: dmEmployee, reason: "dm_default" }];
    }
  }

  return [];
}
