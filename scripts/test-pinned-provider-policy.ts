/**
 * V20.1.2 — Pinned provider policy tests.
 */

import { routeCapability } from "@/lib/ai/runtime/capability-router";
import { isMockFallbackAllowed } from "@/lib/ai/runtime/route-optimizer";
import {
  PINNED_PROVIDER_POLICY_V2012,
  resolvePinnedPolicyRouteByKey,
} from "@/lib/ai/runtime/provider-policy";
import { SILICONFLOW_STRONG_MODEL, SILICONFLOW_LONG_CONTEXT_MODEL } from "@/lib/config/features";
import { staticCatalogOffers } from "@/lib/ai/runtime/catalog/loader";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

const BOTH_CONFIGURED = {
  AI_GATEWAY_API_KEY: "test-gateway-key",
  SILICONFLOW_API_KEY: "test-sf-key",
  AI_RUNTIME_ROUTE_OPTIMIZER: "off",
  AI_RUNTIME_V2_PROVIDER_PREF: "auto",
};

async function main() {
  const offers = staticCatalogOffers();

  await run("cheap mode routes to SiliconFlow DeepSeek V3", async () => {
    await withEnv(BOTH_CONFIGURED, () => {
      const route = routeCapability(
        { capability: "quick_reply", runtimeMode: "efficient", modelMode: "cheap", catalogOffers: offers },
        "auto",
      );
      assert(route.providerRoute === "siliconflow_direct", route.providerRoute);
      assert(route.modelId === PINNED_PROVIDER_POLICY_V2012.cheap.modelId, route.modelId);
      assert(route.pinnedPolicy?.policyKey === "cheap", String(route.pinnedPolicy?.policyKey));
    });
  });

  await run("balanced mode routes to SiliconFlow DeepSeek V4 Flash", async () => {
    await withEnv(BOTH_CONFIGURED, () => {
      const route = routeCapability(
        { capability: "structured_chat", runtimeMode: "balanced", modelMode: "balanced", catalogOffers: offers },
        "auto",
      );
      assert(route.providerRoute === "siliconflow_direct", route.providerRoute);
      assert(route.modelId === PINNED_PROVIDER_POLICY_V2012.balanced.modelId, route.modelId);
    });
  });

  await run("strong mode routes to Vercel DeepSeek V4 Pro with slug deepseek", async () => {
    await withEnv(BOTH_CONFIGURED, () => {
      const route = routeCapability(
        { capability: "deep_reasoning", runtimeMode: "strong", modelMode: "strong", catalogOffers: offers },
        "auto",
      );
      assert(route.providerRoute === "vercel_gateway", route.providerRoute);
      assert(route.modelId === "deepseek/deepseek-v4-pro", route.modelId);
      assert(route.gatewayProviderSlug === "deepseek", String(route.gatewayProviderSlug));
    });
  });

  await run("long_context mode routes to Vercel MiniMax M2.5 with slug deepinfra", async () => {
    await withEnv(BOTH_CONFIGURED, () => {
      const route = routeCapability(
        {
          capability: "long_context",
          runtimeMode: "long_context",
          modelMode: "long_context",
          catalogOffers: offers,
        },
        "auto",
      );
      assert(route.providerRoute === "vercel_gateway", route.providerRoute);
      assert(route.modelId === "minimax/minimax-m2.5", route.modelId);
      assert(route.gatewayProviderSlug === "deepinfra", String(route.gatewayProviderSlug));
    });
  });

  await run("coding mode routes to SiliconFlow Qwen3 Coder", async () => {
    await withEnv(BOTH_CONFIGURED, () => {
      const route = routeCapability(
        { capability: "coding", runtimeMode: "coding", modelMode: "coding", catalogOffers: offers },
        "auto",
      );
      assert(route.providerRoute === "siliconflow_direct", route.providerRoute);
      assert(route.modelId === PINNED_PROVIDER_POLICY_V2012.coding.modelId, route.modelId);
    });
  });

  await run("embedding mode stays pinned to SiliconFlow BGE", async () => {
    await withEnv(BOTH_CONFIGURED, () => {
      const route = routeCapability(
        { capability: "embedding", runtimeMode: "embedding", catalogOffers: offers },
        "auto",
      );
      assert(route.providerRoute === "siliconflow_direct", route.providerRoute);
      assert(route.modelId === PINNED_PROVIDER_POLICY_V2012.embedding.modelId, route.modelId);
    });
  });

  await run("gateway unavailable → strong falls back to SiliconFlow DeepSeek V4 Pro", async () => {
    await withEnv(
      { ...BOTH_CONFIGURED, AI_GATEWAY_API_KEY: undefined },
      () => {
        const pinned = resolvePinnedPolicyRouteByKey("strong", {
          gatewayAvailable: false,
          siliconflowAvailable: true,
        });
        assert(pinned.providerRoute === "siliconflow_direct", pinned.providerRoute);
        assert(pinned.modelId === SILICONFLOW_STRONG_MODEL, pinned.modelId);
        assert(pinned.gatewayFallbackApplied === true, "fallback flag");

        const route = routeCapability(
          { capability: "deep_reasoning", runtimeMode: "strong", modelMode: "strong", catalogOffers: offers },
          "auto",
        );
        assert(route.providerRoute === "siliconflow_direct", route.providerRoute);
        assert(route.modelId === SILICONFLOW_STRONG_MODEL, route.modelId);
      },
    );
  });

  await run("gateway unavailable → long_context falls back to SiliconFlow MiniMax M2.5", async () => {
    await withEnv(
      { ...BOTH_CONFIGURED, AI_GATEWAY_API_KEY: undefined },
      () => {
        const pinned = resolvePinnedPolicyRouteByKey("long_context", {
          gatewayAvailable: false,
          siliconflowAvailable: true,
        });
        assert(pinned.providerRoute === "siliconflow_direct", pinned.providerRoute);
        assert(pinned.modelId === SILICONFLOW_LONG_CONTEXT_MODEL, pinned.modelId);

        const route = routeCapability(
          {
            capability: "long_context",
            runtimeMode: "long_context",
            modelMode: "long_context",
            catalogOffers: offers,
          },
          "auto",
        );
        assert(route.providerRoute === "siliconflow_direct", route.providerRoute);
        assert(route.modelId === SILICONFLOW_LONG_CONTEXT_MODEL, route.modelId);
      },
    );
  });

  await run("route optimizer shadow does not change actual pinned route", async () => {
    await withEnv(
      { ...BOTH_CONFIGURED, AI_RUNTIME_ROUTE_OPTIMIZER: "shadow" },
      () => {
        const route = routeCapability(
          { capability: "deep_reasoning", runtimeMode: "strong", modelMode: "strong", catalogOffers: offers },
          "auto",
        );
        assert(route.providerRoute === "vercel_gateway", route.providerRoute);
        assert(route.modelId === "deepseek/deepseek-v4-pro", route.modelId);
        assert(route.routeOptimizer?.shadowOnly === true, "shadow meta expected");
        assert(
          route.routeOptimizer?.selectedProviderRoute !== route.providerRoute ||
            route.routeOptimizer?.selectedModelId !== route.modelId ||
            route.routeOptimizer != null,
          "optimizer comparison present",
        );
      },
    );
  });

  await run("production never falls back to mock unless explicitly allowed", async () => {
    await withEnv(
      {
        AI_GATEWAY_API_KEY: undefined,
        SILICONFLOW_API_KEY: undefined,
        AI_RUNTIME_V2_PROVIDER_PREF: "auto",
        AI_RUNTIME_ROUTE_OPTIMIZER: "off",
        NODE_ENV: "production",
      },
      () => {
        assert(!isMockFallbackAllowed(), "mock not allowed in production");
        const route = routeCapability(
          { capability: "structured_chat", runtimeMode: "balanced", catalogOffers: offers },
          "auto",
        );
        assert(route.providerRoute !== "mock", `unexpected mock route: ${route.providerRoute}`);
      },
    );
  });

  console.log("\nAll pinned provider policy tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
