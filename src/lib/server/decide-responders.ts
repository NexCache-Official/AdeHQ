import type { AIEmployee, MentionRef, ProjectRoom, ResponseReason, RoomTopic } from "@/lib/types";
import type { ChannelGovernanceContext } from "@/lib/server/channel-governance";
import { planConversation } from "@/lib/server/conversation-orchestrator";

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
  rootTriggerMessageId?: string;
};

export function decideResponders(
  content: string,
  topic: RoomTopic,
  room: ProjectRoom,
  employees: AIEmployee[],
  mentionsJson?: MentionRef[],
  options?: DecideRespondersOptions,
): ResponderDecision[] {
  const { decisions } = planConversation(content, topic, room, employees, mentionsJson, options);
  return decisions;
}

export { planConversation } from "@/lib/server/conversation-orchestrator";
