/**
 * V19.9.0e — Vercel Gateway adapter tests (mock + optional live smoke).
 *
 * Usage: npm run test:runtime:vercel
 */

import { z } from "zod";
import {
  createVercelGatewayAdapter,
  isVercelGatewayAdapterAvailable,
} from "@/lib/ai/runtime/adapters/vercel-gateway";
import type { MockAdapterOptions, MockGenerateObjectHandler } from "@/lib/ai/runtime/adapters/base";
import {
  isVercelGatewayConfigured,
  listVercelGatewayModelMappings,
  resolveVercelGatewayModelId,
  VERCEL_GATEWAY_DEFAULT_MODELS,
} from "@/lib/ai/runtime/adapters/vercel-models";
import { routeCapability } from "@/lib/ai/runtime/capability-router";
import { findCatalogModelsForCapability } from "@/lib/ai/runtime/catalog/seed";

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

async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}`);
    console.log(`      ${detail}`);
    throw error;
  }
}

async function main() {
  console.log("AdeHQ Vercel Gateway Adapter — V19.9.0e\n");

  let passed = 0;
  let skipped = 0;

  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  const skip = (name: string, reason: string) => {
    console.log(`SKIP  ${name}`);
    console.log(`      ${reason}`);
    skipped += 1;
  };

  await run("missing AI_GATEWAY_API_KEY marks live path unavailable", async () => {
    await withEnv({ AI_GATEWAY_API_KEY: undefined }, () => {
      assert(!isVercelGatewayConfigured(), "expected gateway not configured");
      assert(!isVercelGatewayAdapterAvailable(), "expected adapter unavailable");
    });
  });

  await run("provider pref vercel selects vercel_gateway when key present", async () => {
    await withEnv(
      {
        AI_GATEWAY_API_KEY: "test-gateway-key",
        AI_RUNTIME_V2_MODE: "on",
        AI_RUNTIME_V2_PROVIDER_PREF: "vercel",
      },
      () => {
        const route = routeCapability(
          { capability: "summarization", message: "weekly report" },
          "vercel",
        );
        assert(route.providerRoute === "vercel_gateway", `got ${route.providerRoute}`);
        assert(route.providerName === "vercel", `got ${route.providerName}`);
      },
    );
  });

  await run("mocked generateText normalizes RuntimeResult shape", async () => {
    const adapter = createVercelGatewayAdapter({
      generateText: async () => "gateway mock reply",
    });

    const result = await adapter.generateText({
      capability: "quick_reply",
      prompt: "Hello",
      runtimeMode: "efficient",
    });

    assert(result.text === "gateway mock reply", "unexpected text");
    assert(result.usage.providerRoute === "vercel_gateway", "unexpected route");
    assert(result.usage.providerName === "vercel", "unexpected provider");
    assert(result.usage.modelId === VERCEL_GATEWAY_DEFAULT_MODELS.efficient, "unexpected model");
  });

  await run("mocked generateObject normalizes structured RuntimeResult", async () => {
    const schema = z.object({ ok: z.boolean(), label: z.string() });
    const mockOptions: MockAdapterOptions = {
      generateObject: (async () => ({ ok: true, label: "vercel-mock" })) as MockGenerateObjectHandler,
    };
    const adapter = createVercelGatewayAdapter(mockOptions);

    const result = await adapter.generateObject({
      capability: "classification",
      prompt: "Classify",
      schema,
      runtimeMode: "balanced",
    });

    const parsed = schema.safeParse(result.object);
    assert(parsed.success, "object must match schema");
    assert(result.usage.providerRoute === "vercel_gateway", "unexpected route");
  });

  await run("mocked embed normalizes RuntimeEmbedResult shape", async () => {
    const adapter = createVercelGatewayAdapter({
      embed: async () => [[0.1, 0.2, 0.3]],
    });

    const result = await adapter.embed({
      capability: "embedding",
      texts: ["hello world"],
      runtimeMode: "embedding",
    });

    assert(result.embeddings.length === 1, "expected one embedding");
    assert(result.embeddings[0]?.length === 3, "expected 3-dim vector");
    assert(result.usage.providerRoute === "vercel_gateway", "unexpected route");
    assert(
      result.usage.modelId === VERCEL_GATEWAY_DEFAULT_MODELS.embedding,
      "unexpected embedding model",
    );
  });

  await run("runtime mode mapping resolves expected gateway model IDs", async () => {
    await withEnv(
      {
        AI_GATEWAY_MODEL_EFFICIENT: undefined,
        AI_GATEWAY_MODEL_BALANCED: undefined,
        AI_GATEWAY_MODEL_STRONG: undefined,
        AI_GATEWAY_MODEL_LONG_CONTEXT: undefined,
        AI_GATEWAY_MODEL_CODING: undefined,
        AI_GATEWAY_MODEL_EMBEDDING: undefined,
      },
      () => {
        assert(
          resolveVercelGatewayModelId({ runtimeMode: "efficient" }) ===
            VERCEL_GATEWAY_DEFAULT_MODELS.efficient,
          "efficient mismatch",
        );
        assert(
          resolveVercelGatewayModelId({ runtimeMode: "balanced" }) ===
            VERCEL_GATEWAY_DEFAULT_MODELS.balanced,
          "balanced mismatch",
        );
        assert(
          resolveVercelGatewayModelId({ runtimeMode: "strong" }) ===
            VERCEL_GATEWAY_DEFAULT_MODELS.strong,
          "strong mismatch",
        );
        assert(
          resolveVercelGatewayModelId({ runtimeMode: "long_context" }) ===
            VERCEL_GATEWAY_DEFAULT_MODELS.long_context,
          "long_context mismatch",
        );
        assert(
          resolveVercelGatewayModelId({ runtimeMode: "coding" }) ===
            VERCEL_GATEWAY_DEFAULT_MODELS.coding,
          "coding mismatch",
        );
        assert(
          resolveVercelGatewayModelId({ runtimeMode: "embedding", capability: "embedding" }) ===
            VERCEL_GATEWAY_DEFAULT_MODELS.embedding,
          "embedding mismatch",
        );
      },
    );
  });

  await run("env overrides replace default gateway model IDs", async () => {
    await withEnv(
      {
        AI_GATEWAY_MODEL_BALANCED: "anthropic/claude-3-haiku",
      },
      () => {
        assert(
          resolveVercelGatewayModelId({ runtimeMode: "balanced" }) ===
            "anthropic/claude-3-haiku",
          "expected env override",
        );
      },
    );
  });

  await run("provider pref auto does not force Vercel as primary when SiliconFlow configured", async () => {
    await withEnv(
      {
        AI_GATEWAY_API_KEY: "test-gateway-key",
        SILICONFLOW_API_KEY: "test-siliconflow-key",
        AI_RUNTIME_V2_PROVIDER_PREF: "auto",
      },
      () => {
        const route = routeCapability(
          { capability: "deep_reasoning", message: "plan research" },
          "auto",
        );
        assert(
          route.providerRoute === "siliconflow_direct",
          `expected siliconflow primary, got ${route.providerRoute}`,
        );
        const hasVercelFallback = route.fallbackCandidates.some(
          (c) => c.providerRoute === "vercel_gateway",
        );
        assert(hasVercelFallback, "expected vercel_gateway as fallback candidate");
      },
    );
  });

  await run("catalog lists vercel_gateway models for core capabilities", () => {
    const summarization = findCatalogModelsForCapability("summarization", "vercel_gateway");
    const embedding = findCatalogModelsForCapability("embedding", "vercel_gateway");
    assert(summarization.length > 0, "expected vercel summarization catalog entry");
    assert(embedding.length > 0, "expected vercel embedding catalog entry");
    assert(
      summarization.every((m) => m.providerRoute === "vercel_gateway"),
      "catalog route mismatch",
    );
  });

  const liveKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!liveKey) {
    skip("live generateText smoke", "AI_GATEWAY_API_KEY missing — live Gateway tests skipped");
    skip("live generateObject smoke", "AI_GATEWAY_API_KEY missing — live Gateway tests skipped");
    skip("live embed smoke", "AI_GATEWAY_API_KEY missing — live Gateway tests skipped");
  } else {
    await run("[LIVE] generateText smoke via Vercel Gateway", async () => {
      const adapter = createVercelGatewayAdapter();
      const result = await adapter.generateText({
        capability: "quick_reply",
        prompt: "Reply with exactly: pong",
        runtimeMode: "efficient",
        maxTokens: 16,
        timeoutMs: 30_000,
      });
      assert(typeof result.text === "string" && result.text.length > 0, "expected non-empty text");
    });

    await run("[LIVE] generateObject smoke via Vercel Gateway", async () => {
      const schema = z.object({ word: z.string() });
      const adapter = createVercelGatewayAdapter();
      const result = await adapter.generateObject({
        capability: "classification",
        prompt: 'Return JSON {"word":"hi"}',
        schema,
        runtimeMode: "efficient",
        maxTokens: 32,
        timeoutMs: 30_000,
      });
      assert(schema.safeParse(result.object).success, "object must match schema");
    });

    await run("[LIVE] embed smoke via Vercel Gateway", async () => {
      const adapter = createVercelGatewayAdapter();
      const result = await adapter.embed({
        capability: "embedding",
        texts: ["tiny live embed probe"],
        runtimeMode: "embedding",
      });
      assert(result.embeddings.length === 1, "expected one embedding vector");
      assert(result.embeddings[0]!.length > 0, "expected non-empty embedding");
    });
  }

  console.log(
    `\n--- Summary ---\nPASS: ${passed}  SKIP: ${skipped}  FAIL: 0  TOTAL: ${passed + skipped}`,
  );
  console.log("\nCatalog mapping defaults:");
  for (const row of listVercelGatewayModelMappings()) {
    console.log(`  ${row.slot}: ${row.resolvedModelId} (${row.envVar})`);
  }
}

main().catch(() => {
  process.exitCode = 1;
});
