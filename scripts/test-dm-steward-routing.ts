/**
 * V20.0.5 — DM steward routing tests.
 * Usage: npm run test:dm-steward
 */

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

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws_test",
    dmRoomId: "room_dm",
    topicId: "topic_main",
    employeeId: "emp_priya",
    employeeName: "Priya Nair",
    employeeRole: "Launch Strategist",
    messageId: "msg_1",
    messageContent: "Hello",
    recentMessages: [],
    ...overrides,
  };
}

async function main() {
  await test("direct factual current question → gateway_search", () => {
    const decision = classifyDmMessageWithSteward(
      baseInput({ messageContent: "What was Anthropic's revenue in 2025?" }),
    );
    expectTrue(decision.intent === "current_fact_question");
    expectTrue(decision.route === "gateway_search" || decision.route === "tavily_search");
    expectTrue(decision.browserRequired === false);
    expectTrue(decision.searchRequired === true);
  });

  await test("normal writing request → employee_model", () => {
    const decision = classifyDmMessageWithSteward(
      baseInput({
        messageContent: "Draft a one-paragraph launch announcement for our new product.",
      }),
    );
    expectTrue(decision.intent === "direct_answer");
    expectTrue(decision.route === "employee_model");
    expectTrue(!decision.browserRequired);
  });

  await test("research + CRM mutation → employee_model with search enrichment", () => {
    const decision = classifyDmMessageWithSteward(
      baseInput({
        messageContent:
          "Add a CRM deal for Dubai Shawarma, Canterbury, UK. Research the business first, then add a $30,000 kitchen renovation deal.",
      }),
    );
    expectTrue(decision.route === "employee_model");
    expectTrue(decision.searchRequired === true);
    expectTrue(/action|tools/i.test(decision.reason));
  });

  await test("deep research request → browser_research", () => {
    const decision = classifyDmMessageWithSteward(
      baseInput({
        messageContent:
          "Research Anthropic revenue, open sources, take screenshots, and create a report",
      }),
    );
    expectTrue(decision.intent === "deep_research_request" || decision.intent === "browser_task");
    expectTrue(decision.route === "browser_research");
    expectTrue(decision.browserRequired === true);
  });

  await test("cleared chat → useArchivedSummary false", () => {
    const decision = classifyDmMessageWithSteward(
      baseInput({
        messageContent: "What was Anthropic's revenue in 2025?",
        chatClearedAt: "2026-07-05T12:00:00.000Z",
        currentSummary: "Old Supabase funding brief summary",
      }),
    );
    expectTrue(decision.contextPolicy.useArchivedSummary === false);
  });

  await test("saved memory available → light memory reference", () => {
    const decision = classifyDmMessageWithSteward(
      baseInput({
        messageContent: "What was Anthropic's revenue in 2025?",
        savedMemory: [{ title: "Supabase context", content: "Previous product work" }],
      }),
    );
    expectTrue(decision.contextPolicy.useSavedMemory === true);
    expectTrue(decision.contextPolicy.memoryReferenceStyle === "light");
  });

  await test("social greeting → social / employee_model", () => {
    const decision = classifyDmMessageWithSteward(baseInput({ messageContent: "Hi Priya" }));
    expectTrue(decision.intent === "social");
    expectTrue(decision.route === "employee_model");
  });

  await test("no Browserbase for simple one-question facts", () => {
    const decision = classifyDmMessageWithSteward(
      baseInput({ messageContent: "Who is the CEO of OpenAI?" }),
    );
    expectTrue(decision.browserRequired === false);
    expectTrue(decision.route !== "browser_research");
    expectTrue(Boolean(decision.costPolicy.avoidBrowserbaseReason));
  });

  console.log("\nAll DM steward routing tests passed.");
}

main().catch(() => process.exit(1));
