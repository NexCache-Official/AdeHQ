import type { AIEmployee, MentionRef, ProjectRoom, ResponseReason, RoomTopic } from "@/lib/types";
import { getEffectiveParticipationMode, filterAllowedEmployees } from "@/lib/topic-ai-control";
import { isGeneralTopic } from "@/lib/topics";
import { pickSmartResponders } from "@/lib/server/smart-participation";
import {
  type ChannelGovernanceContext,
  isGroupGreeting,
  isBroadcastToEveryone,
  isRoomCooldownActive,
  pickGreetingEmployee,
} from "@/lib/server/channel-governance";
import { extractMentions } from "@/lib/utils";

export type ResponderDecision = {
  employee: AIEmployee;
  reason: ResponseReason;
  isGreetingRun?: boolean;
  runMetadata?: Record<string, unknown>;
};

export type DecideRespondersOptions = {
  forceEmployeeIds?: string[];
  maxParallel?: number;
  governance?: ChannelGovernanceContext;
};

export function decideResponders(
  content: string,
  topic: RoomTopic,
  room: ProjectRoom,
  employees: AIEmployee[],
  mentionsJson?: MentionRef[],
  options?: DecideRespondersOptions,
): ResponderDecision[] {
  const max = options?.maxParallel ?? 3;
  const participation = getEffectiveParticipationMode(topic);
  const isDM = room.kind === "dm";
  const allowed = filterAllowedEmployees(topic, employees);
  const governance = options?.governance;

  if (options?.forceEmployeeIds?.length) {
    return allowed
      .filter((e) => options.forceEmployeeIds!.includes(e.id))
      .slice(0, max)
      .map((employee) => ({ employee, reason: "slash_command" }));
  }

  const mentionedIds = new Set<string>();
  if (mentionsJson?.length) {
    for (const m of mentionsJson) {
      if (m.type === "ai_employee") mentionedIds.add(m.id);
    }
  }
  for (const id of extractMentions(
    content,
    allowed.map((e) => ({ id: e.id, name: e.name })),
  )) {
    mentionedIds.add(id);
  }
  const mentioned = allowed.filter((e) => mentionedIds.has(e.id));

  if (mentioned.length > 0) {
    return mentioned
      .slice(0, max)
      .map((employee) => ({ employee, reason: "explicit_mention" }));
  }

  if (participation === "silent_observation" || participation === "manual_only") {
    if (isDM && isGeneralTopic(topic)) {
      const dmEmployee =
        allowed.find((e) => e.id === room.dmEmployeeId) ?? allowed[0];
      if (dmEmployee) {
        return [{ employee: dmEmployee, reason: "dm_default" }];
      }
    }
    return [];
  }

  if (governance?.lastMessageSenderType === "ai" && !isDM) {
    return [];
  }

  if (isRoomCooldownActive(governance ?? {})) {
    return [];
  }

  if (isGroupGreeting(content) || (isBroadcastToEveryone(content) && isGeneralTopic(topic))) {
    const greeter = pickGreetingEmployee(allowed);
    if (greeter) {
      return [{ employee: greeter, reason: "group_greeting", isGreetingRun: true }];
    }
  }

  const smart = pickSmartResponders(content, allowed, participation, max);
  if (smart.length) {
    return smart.map((employee) => ({
      employee,
      reason: "smart_assist_role_match" as const,
    }));
  }

  if (isDM && isGeneralTopic(topic)) {
    const dmEmployee =
      allowed.find((e) => e.id === room.dmEmployeeId) ?? allowed[0];
    if (dmEmployee) {
      return [{ employee: dmEmployee, reason: "dm_default" }];
    }
  }

  return [];
}
