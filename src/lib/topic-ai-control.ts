import type { AIEmployee, AiParticipationMode, RoomTopic } from "@/lib/types";
import { getAiParticipationMode } from "@/lib/topics";

export type TopicAiControlState = {
  aiStopped: boolean;
  smartAssistPaused: boolean;
  aiPausedUntil: string | null;
  blockedEmployeeIds: string[];
};

export function getTopicAiControlState(topic: RoomTopic): TopicAiControlState {
  const meta = topic.metadata ?? {};
  const aiPausedUntil =
    typeof meta.aiPausedUntil === "string" ? meta.aiPausedUntil : null;
  const smartAssistPaused =
    Boolean(meta.smartAssistPaused) ||
    (aiPausedUntil ? +new Date(aiPausedUntil) > Date.now() : false);
  return {
    aiStopped: Boolean(meta.aiStopped),
    smartAssistPaused,
    aiPausedUntil,
    blockedEmployeeIds: Array.isArray(meta.blockedEmployeeIds)
      ? (meta.blockedEmployeeIds as string[])
      : [],
  };
}

export function getEffectiveParticipationMode(
  topic: RoomTopic,
): AiParticipationMode {
  const control = getTopicAiControlState(topic);
  if (control.aiStopped || control.smartAssistPaused) return "manual_only";
  return getAiParticipationMode(topic);
}

export function isEmployeeBlockedInTopic(
  topic: RoomTopic,
  employeeId: string,
): boolean {
  const control = getTopicAiControlState(topic);
  if (control.aiStopped) return true;
  return control.blockedEmployeeIds.includes(employeeId);
}

export function isAiQueueingBlocked(topic: RoomTopic): boolean {
  return getTopicAiControlState(topic).aiStopped;
}

export function filterAllowedEmployees(
  topic: RoomTopic,
  employees: AIEmployee[],
): AIEmployee[] {
  const control = getTopicAiControlState(topic);
  if (control.aiStopped) return [];
  if (!control.blockedEmployeeIds.length) return employees;
  return employees.filter((e) => !control.blockedEmployeeIds.includes(e.id));
}
