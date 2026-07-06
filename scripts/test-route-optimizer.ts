/**
 * V20.1.0b — Route optimizer unit tests.
 */

import { staticCatalogOffers } from "@/lib/ai/runtime/catalog/loader";
import { setRouteHealthCache, type RouteHealthSnapshot } from "@/lib/ai/runtime/route-health";
import {
  isMockFallbackAllowed,
  listCandidateOffers,
  selectBestModelOffer,
} from "@/lib/ai/runtime/route-optimizer";
import type { ModelEndpointOffer } from "@/lib/ai/runtime/pricing/types";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

function sampleOffers(): ModelEndpointOffer[] {
  return [
    {
      providerRoute: "siliconflow_direct",
      providerName: "siliconflow",
      modelId: "deepseek-ai/DeepSeek-V3",
      normalizedModelFamily: "deepseek-v3",
      displayName: "DeepSeek V3",
      modelType: "language",
      capabilities: ["structured_chat", "summarization", "quick_reply"],
      runtimeModes: ["efficient", "balanced"],
      inputCostPerMillion: 0.1,
      outputCostPerMillion: 0.15,
      currency: "USD",
      qualityScore: 7,
      reliabilityScore: 8,
      supportsJson: true,
      supportsTools: false,
      supportsEmbeddings: false,
      supportsLongContext: false,
      enabled: true,
      source: "manual_seed",
      priceFetchedAt: new Date().toISOString(),
    },
    {
      providerRoute: "vercel_gateway",
      providerName: "vercel",
      modelId: "openai/gpt-4o-mini",
      normalizedModelFamily: "gpt-4o-mini",
      displayName: "GPT-4o Mini",
      modelType: "language",
      capabilities: ["structured_chat", "summarization", "quick_reply"],
      runtimeModes: ["efficient", "balanced"],
      inputCostPerMillion: 0.15,
      outputCostPerMillion: 0.6,
      currency: "USD",
      qualityScore: 7.5,
      reliabilityScore: 8.5,
      supportsJson: true,
      supportsTools: true,
      supportsEmbeddings: false,
      supportsLongContext: false,
      enabled: true,
      source: "manual_seed",
      priceFetchedAt: new Date().toISOString(),
    },
    {
      providerRoute: "mock",
      providerName: "mock",
      modelId: "mock-balanced",
      normalizedModelFamily: "mock-balanced",
      displayName: "Mock",
      modelType: "language",
      capabilities: ["structured_chat"],
      runtimeModes: ["balanced"],
      inputCostPerMillion: 0,
      outputCostPerMillion: 0,
      currency: "USD",
      supportsJson: true,
      supportsTools: false,
      supportsEmbeddings: false,
      supportsLongContext: false,
      enabled: true,
      source: "manual_seed",
    },
  ];
}

async function main() {
  const offers = sampleOffers();

  await run("cost_saver picks cheapest capable offer", () => {
    const decision = selectBestModelOffer(
      {
        capability: "structured_chat",
        runtimeMode: "balanced",
        routingPreference: "cost_saver",
        providerPreference: "auto",
        requiresJson: true,
      },
      offers,
    );
    assert(decision != null, "decision required");
    const d = decision!;
    assert(
      d.selected.modelId === "deepseek-ai/DeepSeek-V3",
      `expected cheap SF, got ${d.selected.modelId}`,
    );
  });

  await run("mock excluded in production scoring", () => {
    const prev = process.env.AI_RUNTIME_V2_PROVIDER_PREF;
    process.env.AI_RUNTIME_V2_PROVIDER_PREF = "auto";
    assert(!isMockFallbackAllowed(), "mock not allowed in prod");
    const candidates = listCandidateOffers(offers, {
      capability: "structured_chat",
      runtimeMode: "balanced",
      routingPreference: "auto",
      providerPreference: "auto",
    });
    assert(!candidates.some((o) => o.providerRoute === "mock"), "mock filtered");
    process.env.AI_RUNTIME_V2_PROVIDER_PREF = prev;
  });

  await run("anti-flapping keeps current route for tiny savings", () => {
    process.env.AI_ROUTE_OPTIMIZER_MIN_SAVINGS_TO_SWITCH = "0.99";
    const decision = selectBestModelOffer(
      {
        capability: "structured_chat",
        runtimeMode: "balanced",
        routingPreference: "cost_saver",
        providerPreference: "auto",
        currentRoute: {
          providerRoute: "vercel_gateway",
          modelId: "openai/gpt-4o-mini",
        },
      },
      offers,
    );
    assert(decision != null, "decision required");
    const d = decision!;
    assert(
      d.decisionFactors.antiFlapApplied || d.selected.providerRoute === "vercel_gateway",
      "expected anti-flap or vercel kept",
    );
  });

  await run("unhealthy cheap route penalized", () => {
    const unhealthy: RouteHealthSnapshot = {
      providerRoute: "siliconflow_direct",
      modelId: "deepseek-ai/DeepSeek-V3",
      successCount: 2,
      failureCount: 18,
      fallbackCount: 5,
      timeoutCount: 3,
      jsonFailureCount: 4,
      windowHours: 168,
      totalSamples: 32,
      successRate: 2 / 32,
      fallbackRate: 5 / 32,
      timeoutRate: 3 / 32,
      jsonFailureRate: 4 / 32,
    };
    setRouteHealthCache(unhealthy);

    const decision = selectBestModelOffer(
      {
        capability: "structured_chat",
        runtimeMode: "balanced",
        routingPreference: "auto",
        providerPreference: "auto",
        requiresJson: true,
      },
      offers,
    );
    assert(decision != null, "decision required");
    const d = decision!;
    assert(
      d.selected.providerRoute === "vercel_gateway",
      "expected healthier vercel route",
    );
  });

  await run("static catalog offers load", () => {
    const staticOffers = staticCatalogOffers();
    assert(staticOffers.length >= 10, "static seed should have multiple offers");
  });

  console.log("\nAll route optimizer tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
