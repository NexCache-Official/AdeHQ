/**
 * PR-14 — Exa-first Brain search unit tests (routing, evidence, chain, flags).
 */

import assert from "node:assert/strict";
import { decideSearchRoute } from "@/lib/ai/search/search-router";
import {
  decideSearchSteward,
  defaultSearchStewardCapabilities,
} from "@/lib/ai/search/search-steward";
import { ttlHoursForSearchNeed } from "@/lib/ai/search/search-cache";
import { getBrainRoute } from "@/lib/brain/catalog/routes";
import { resolveRoutingPolicy } from "@/lib/brain/catalog/routing-policy";
import { isBrainSearchV1Enabled } from "@/lib/brain/flags";
import {
  assessSearchEvidence,
  mapNeedToSearchRouteChain,
  shouldFallbackFromEvidence,
} from "@/lib/brain/search";
import { calculateSearchCost } from "@/lib/billing/costing/calculate-search-cost";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";

function withEnv(patch: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

let passed = 0;
function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

run("catalog: Exa is production primary with Perplexity then Tavily fallbacks", () => {
  const exa = getBrainRoute("route_search_exa");
  assert.equal(exa?.environment, "production");
  assert.deepEqual(exa?.fallbackRouteIds, [
    "route_search_perplexity",
    "route_search_tavily",
  ]);
  const policy = resolveRoutingPolicy("search_semantic", "standard");
  assert.equal(policy?.primaryRouteId, "route_search_exa");
  assert.ok(policy?.backupRouteIds.includes("route_search_perplexity"));
});

run("ordinary external search selects Exa when configured", () => {
  withEnv(
    {
      ADEHQ_BRAIN_SEARCH_V1: "1",
      EXA_API_KEY: "test-exa",
      AI_GATEWAY_API_KEY: "test-gw",
      TAVILY_API_KEY: "test-tavily",
    },
    () => {
      const steward = decideSearchSteward(
        "What was Apple's revenue in fiscal 2025?",
        {},
        { exa: true, gatewaySearch: true, tavily: true, browserbase: false },
      );
      assert.equal(steward.provider, "gateway_exa");
      assert.ok(steward.fallbackChain?.includes("gateway_perplexity"));
      assert.ok(steward.fallbackChain?.includes("tavily"));
      assert.equal(steward.browserRequired, false);

      const route = decideSearchRoute("What was Apple's revenue in fiscal 2025?");
      assert.equal(route.route, "gateway_exa");
    },
  );
});

run("Perplexity is not selected when Exa is healthy", () => {
  withEnv(
    {
      ADEHQ_BRAIN_SEARCH_V1: "1",
      EXA_API_KEY: "test-exa",
      AI_GATEWAY_API_KEY: "test-gw",
    },
    () => {
      const steward = decideSearchSteward(
        "Research the AI HR software landscape",
        {},
        { exa: true, gatewaySearch: true, tavily: true, browserbase: false },
      );
      assert.equal(steward.provider, "gateway_exa");
      assert.notEqual(steward.provider, "gateway_perplexity");
    },
  );
});

run("chain maps need to Exa → Perplexity → Tavily", () => {
  withEnv(
    {
      EXA_API_KEY: "x",
      AI_GATEWAY_API_KEY: "y",
      TAVILY_API_KEY: "z",
      ADEHQ_SEARCH_PRIMARY: "exa",
      ADEHQ_SEARCH_FALLBACK_1: "perplexity",
      ADEHQ_SEARCH_FALLBACK_2: "tavily",
    },
    () => {
      assert.deepEqual(mapNeedToSearchRouteChain("company_research"), [
        "gateway_exa",
        "gateway_perplexity",
        "tavily",
      ]);
      assert.deepEqual(mapNeedToSearchRouteChain("website_interaction"), ["browserbase"]);
    },
  );
});

run("Browserbase only for interaction", () => {
  withEnv({ ADEHQ_BRAIN_SEARCH_V1: "1" }, () => {
    const fact = decideSearchSteward(
      "What is the official Supabase realtime authorization documentation?",
      {},
      { ...defaultSearchStewardCapabilities(), exa: true, gatewaySearch: true },
    );
    assert.notEqual(fact.provider, "browserbase");

    const interactive = decideSearchSteward(
      "Log into the CRM and export the latest leads",
      { preferAgentMode: true },
      { exa: true, gatewaySearch: true, tavily: true, browserbase: true },
    );
    assert.equal(interactive.provider, "browserbase");
    assert.equal(interactive.browserRequired, true);
  });
});

run("evidence gate does not fallback merely for few sources", () => {
  const assessment = assessSearchEvidence(
    [
      {
        title: "Apple reports Q1 revenue",
        url: "https://www.apple.com/newsroom/2026/01/revenue/",
        snippet: "Apple today announced fiscal 2026 first quarter revenue of $143.8 billion.",
      },
    ],
    {
      query: "Apple revenue fiscal 2026",
      need: "current_fact",
      freshness: "recent",
    },
  );
  assert.equal(assessment.hasUsableSources, true);
  assert.equal(shouldFallbackFromEvidence(assessment), false);
});

run("evidence gate falls back when sources do not address query", () => {
  const assessment = assessSearchEvidence(
    [
      {
        title: "Unrelated blog",
        url: "https://example.com/cats",
        snippet: "Cute cats and gardening tips for spring.",
      },
    ],
    {
      query: "Apple fiscal 2026 revenue",
      need: "current_fact",
      freshness: "recent",
    },
  );
  assert.equal(assessment.hasUsableSources, false);
  assert.ok(assessment.fallbackReason);
});

run("WH metering for Exa / Perplexity / Tavily unit costs", () => {
  const exa = calculateSearchCost("exa", 1);
  assert.ok(Math.abs(exa.costUsd - 0.007) < 1e-9);
  assert.equal(workHoursFromCost(exa.costUsd), 0.7);

  const pplx = calculateSearchCost("perplexity", 1);
  assert.ok(Math.abs(pplx.costUsd - 0.005) < 1e-9);
  assert.equal(workHoursFromCost(pplx.costUsd), 0.5);

  const tavily = calculateSearchCost("tavily", 1);
  assert.ok(tavily.costUsd > 0);
  assert.ok(workHoursFromCost(tavily.costUsd) > 0);
});

run("cache TTL by need", () => {
  assert.ok(ttlHoursForSearchNeed("current_fact") < 2);
  assert.ok(ttlHoursForSearchNeed("company_research") >= 6);
  assert.ok(ttlHoursForSearchNeed("technical_docs") >= 24);
  assert.ok(ttlHoursForSearchNeed("academic_research") >= 48);
});

run("kill switch disables Brain Search V1", () => {
  withEnv({ ADEHQ_BRAIN_SEARCH_V1: "0" }, () => {
    assert.equal(isBrainSearchV1Enabled(), false);
  });
  withEnv({ ADEHQ_BRAIN_SEARCH_V1: "1" }, () => {
    assert.equal(isBrainSearchV1Enabled(), true);
  });
});

console.log(`\n${passed} checks`);
if (process.exitCode) process.exit(process.exitCode);
console.log("PASS  test-brain-search-exa-first");
