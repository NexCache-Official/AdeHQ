/**
 * Brain PR-9: Steward Core facade returns identical DM decisions as direct steward.
 * Usage: npx tsx scripts/test-brain-steward-facade.ts
 */
import { classifyDmMessageWithSteward, type DmStewardInput } from "@/lib/orchestration/dm-steward";
import { decide, decideDm } from "@/lib/brain/steward-core";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const input: DmStewardInput = {
    workspaceId: "ws_test",
    dmRoomId: "room_test",
    topicId: "topic_test",
    employeeId: "emp_test",
    employeeName: "Alex",
    employeeRole: "pm",
    messageId: "msg_test",
    messageContent: "Hello, can you help me draft a short update?",
    recentMessages: [],
    currentSummary: null,
    savedMemory: [],
  };

  const direct = classifyDmMessageWithSteward(input);
  const viaFacade = decideDm(input);
  assert(JSON.stringify(direct) === JSON.stringify(viaFacade), "decideDm must match classifyDm");

  const wrapped = await decide({ channel: "dm", input });
  assert(wrapped.channel === "dm", "channel dm");
  assert(JSON.stringify(wrapped.decision) === JSON.stringify(direct), "decide(dm) snapshot identical");

  console.log("PASS  test-brain-steward-facade");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
