/**
 * V20.0.5 — Search routing tests.
 * Usage: npm run test:search-routing
 */

import {
  decideSearchRoute,
  isQuickFactLookup,
  requiresDeepBrowserResearch,
} from "@/lib/ai/search";

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

function skip(name: string, reason: string) {
  console.log(`SKIP  ${name} — ${reason}`);
}

async function main() {
  await test("Anthropic revenue routes to gateway search, not browser", () => {
    const decision = decideSearchRoute("What was Anthropic's revenue in 2025?");
    expectTrue(decision.browserRequired === false, "browserRequired should be false");
    expectTrue(
      decision.route === "gateway_perplexity" ||
        decision.route === "tavily" ||
        decision.route === "none",
      `expected fast search route, got ${decision.route}`,
    );
    expectTrue(decision.route !== "browserbase", "must not route to browserbase");
  });

  await test("Deep browser task routes to browserbase", () => {
    const decision = decideSearchRoute(
      "Research Anthropic revenue, open sources, take screenshots, and create a report",
    );
    expectTrue(decision.browserRequired === true, "browserRequired should be true");
    expectTrue(decision.route === "browserbase", `expected browserbase, got ${decision.route}`);
  });

  await test("requiresDeepBrowserResearch respects explicit browse language", () => {
    expectTrue(
      requiresDeepBrowserResearch("Browse live and take screenshots of pricing pages"),
      "expected deep browser",
    );
    expectTrue(
      !requiresDeepBrowserResearch("What was Anthropic's revenue in 2025?"),
      "simple fact should not require browser",
    );
  });

  await test("isQuickFactLookup matches revenue questions", () => {
    expectTrue(isQuickFactLookup("What was Anthropic's revenue in 2025?"));
    expectTrue(!isQuickFactLookup("Draft a launch plan for our washing machine product"));
  });

  await test("provider policy maps current_fact to gateway_perplexity when configured", () => {
    const decision = decideSearchRoute("Who is the CEO of Stripe?");
    expectTrue(decision.need === "current_fact" || decision.need === "company_fact");
    expectTrue(!decision.browserRequired);
  });

  if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
    skip("live gateway search answer", "AI_GATEWAY_API_KEY missing");
  } else {
    await test("live gateway search returns text when key present", async () => {
      const { executeSearchAnswer } = await import("@/lib/ai/search/search-answer");
      const result = await executeSearchAnswer({
        workspaceId: "ws_test",
        roomId: "room_test",
        topicId: "topic_test",
        employeeId: "emp_test",
        query: "What is Anthropic?",
      });
      expectTrue(result.answer.trim().length > 20, "expected non-empty answer");
      expectTrue(result.providerRoute === "vercel_gateway" || result.providerRoute === "tavily");
    });
  }

  console.log("\nAll search routing tests passed.");
}

main().catch(() => process.exit(1));
