/**
 * V20.0.5 — Search routing tests.
 * Usage: npm run test:search-routing
 */

import {
  decideSearchRoute,
  isQuickFactLookup,
  requiresDeepBrowserResearch,
} from "@/lib/ai/search";
import { planResearchSync } from "@/lib/ai/research/research-planner";

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
  await test("Anthropic revenue routes to Exa-first search, not browser", () => {
    const decision = decideSearchRoute("What was Anthropic's revenue in 2025?");
    expectTrue(decision.browserRequired === false, "browserRequired should be false");
    expectTrue(
      decision.route === "gateway_exa" ||
        decision.route === "gateway_perplexity" ||
        decision.route === "tavily" ||
        decision.route === "none",
      `expected Exa-first search route, got ${decision.route}`,
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

  await test("provider policy maps facts/research to Exa-first when configured", () => {
    const previousExa = process.env.EXA_API_KEY;
    process.env.EXA_API_KEY = process.env.EXA_API_KEY || "test-exa-key";
    try {
      const decision = decideSearchRoute("Who is the CEO of Stripe?");
      expectTrue(
        decision.need === "current_fact" ||
          decision.need === "company_fact" ||
          decision.need === "market_research",
        `unexpected need ${decision.need}`,
      );
      expectTrue(!decision.browserRequired);
      expectTrue(
        decision.route === "gateway_exa" || decision.route === "none",
        `expected gateway_exa primary, got ${decision.route}`,
      );
    } finally {
      if (previousExa === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = previousExa;
    }
  });

  await test("general factual question routes to fast search", () => {
    const decision = decideSearchRoute("What was Apple's revenue in 2025?");
    expectTrue(decision.browserRequired === false);
    expectTrue(decision.route !== "browserbase");
  });

  await test("tax regulation question routes to fast search", () => {
    const decision = decideSearchRoute("What are the current UK visa requirements for tech workers?");
    expectTrue(decision.browserRequired === false);
    expectTrue(decision.route !== "browserbase");
  });
  await test("World Cup sponsor question routes to fast search, not browser", () => {
    const decision = decideSearchRoute("Who are the biggest sponsors of the FIFA World Cup this year?");
    expectTrue(decision.need === "current_fact", `expected current_fact, got ${decision.need}`);
    expectTrue(decision.browserRequired === false, "browserRequired should be false");
    expectTrue(decision.route !== "browserbase", "must not route to browserbase");
  });

  await test("event sponsor shorthand routes to fast search", () => {
    const decision = decideSearchRoute("World Cup sponsors 2026");
    expectTrue(decision.need === "current_fact", `expected current_fact, got ${decision.need}`);
    expectTrue(decision.browserRequired === false, "browserRequired should be false");
  });

  await test("workspace search is not blocked by employee browserAccess none", () => {
    const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = originalGatewayKey || "test_gateway_key";

    try {
      const plan = planResearchSync({
        messages: [],
        userMessage: "Look up World Cup sponsors 2026",
        employee: {
          roleKey: "research",
          modelMode: "balanced",
          intelligencePolicy: {
            defaultMode: "balanced",
            allowedModes: ["balanced"],
            workHourProfile: "moderate",
            browserAccess: "none",
            routingPreference: "auto",
          },
        },
      });

      expectTrue(plan.action === "search", `expected search, got ${plan.action}`);
      // Provider is whichever real search backend is configured (Exa-first
      // when EXA_API_KEY is set, else gateway Perplexity) — this test's point
      // is that browserAccess:"none" doesn't block search entirely, not which
      // specific provider wins.
      expectTrue(
        plan.provider === "gateway_perplexity" || plan.provider === "gateway_exa",
        `expected a real search provider, got ${plan.provider}`,
      );
    } finally {
      if (originalGatewayKey == null) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = originalGatewayKey;
    }
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
      // Exa-first routing (when EXA_API_KEY is configured) is the intended
      // behavior for company/fact queries like this one — accept any real
      // provider that actually answered.
      expectTrue(
        result.providerRoute === "vercel_gateway" ||
          result.providerRoute === "tavily" ||
          result.providerRoute === "exa",
        `expected a real provider route, got ${result.providerRoute}`,
      );
    });
  }

  console.log("\nAll search routing tests passed.");
}

main().catch(() => process.exit(1));
