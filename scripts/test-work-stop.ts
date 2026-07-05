/**
 * Work stop / interrupt tests.
 * Usage: npm run test:work-stop
 */

import { detectWorkStopRequest, buildWorkStopAcknowledgment } from "@/lib/orchestration/work-stop";
import { classifyDmMessageWithSteward } from "@/lib/orchestration/dm-steward";

function expectTrue(condition: boolean, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function main() {
  await test("detects stop the search", () => {
    const d = detectWorkStopRequest("Priya stop the search");
    expectTrue(d.isStop);
    expectTrue(d.target === "search" || d.target === "all");
  });

  await test("detects cancel browsing", () => {
    const d = detectWorkStopRequest("cancel the browser research");
    expectTrue(d.isStop);
  });

  await test("does not treat normal message as stop", () => {
    const d = detectWorkStopRequest("What was Anthropic's revenue in 2025?");
    expectTrue(!d.isStop);
  });

  await test("ack mentions stopped browser research", () => {
    const reply = buildWorkStopAcknowledgment({
      employeeName: "Priya",
      cancelledBrowserResearchCount: 1,
      cancelledAgentRunCount: 0,
    });
    expectTrue(/stopped the live search/i.test(reply));
  });

  await test("DM steward routes stop to employee_model", () => {
    const decision = classifyDmMessageWithSteward({
      workspaceId: "ws",
      dmRoomId: "room",
      topicId: "topic",
      employeeId: "emp",
      employeeName: "Priya",
      employeeRole: "Analyst",
      messageId: "msg",
      messageContent: "stop the search",
      recentMessages: [],
    });
    expectTrue(decision.intent === "stop_active_work");
    expectTrue(decision.route === "employee_model");
    expectTrue(!decision.browserRequired);
  });

  console.log("\nAll work stop tests passed.");
}

main().catch(() => process.exit(1));
