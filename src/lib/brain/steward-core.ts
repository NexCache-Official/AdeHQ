import {
  classifyDmMessageWithSteward,
  type DmStewardDecision,
  type DmStewardInput,
} from "@/lib/orchestration/dm-steward";
import {
  classifyRoomMessageWithSteward,
  type RoomStewardClassifyOptions,
  type RoomStewardInput,
} from "@/lib/orchestration/room-steward";
import { suggestTopicsSync } from "@/lib/orchestration/topic-steward";
import type {
  OrchestrationIntent,
  OrchestratorInput,
  RoomStewardDecision,
  TopicStewardSuggestion,
} from "@/lib/orchestration/types";
import type { RoomTopic } from "@/lib/types";

export type StewardChannel = "room" | "dm" | "topic";

export type StewardDecision =
  | { channel: "room"; decision: RoomStewardDecision }
  | { channel: "dm"; decision: DmStewardDecision }
  | { channel: "topic"; decision: TopicStewardSuggestion[] };

export type StewardDecideInput =
  | { channel: "room"; input: RoomStewardInput; options?: RoomStewardClassifyOptions }
  | { channel: "dm"; input: DmStewardInput }
  | {
      channel: "topic";
      input: OrchestratorInput;
      intent: OrchestrationIntent;
      topic?: Pick<RoomTopic, "title" | "metadata">;
    };

/**
 * Steward Core facade — single seam for Phase 3 (leases, blackboard).
 * Internally dispatches to existing room/dm/topic stewards unchanged.
 */
export async function decide(input: StewardDecideInput): Promise<StewardDecision> {
  switch (input.channel) {
    case "room": {
      const decision = await classifyRoomMessageWithSteward(input.input, input.options);
      return { channel: "room", decision };
    }
    case "dm": {
      const decision = classifyDmMessageWithSteward(input.input);
      return { channel: "dm", decision };
    }
    case "topic": {
      const decision = suggestTopicsSync(input.input, input.intent, input.topic);
      return { channel: "topic", decision };
    }
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}

/** Sync DM path for callers that cannot await. */
export function decideDm(input: DmStewardInput): DmStewardDecision {
  return classifyDmMessageWithSteward(input);
}
