/**
 * V19.9.2 — SiliconFlow live provider smoke tests.
 *
 * Usage: npm run test:runtime:siliconflow
 */

import { z } from "zod";
import {
  createSiliconFlowAdapter,
  isSiliconFlowAdapterAvailable,
} from "@/lib/ai/runtime/adapters/siliconflow";
import { routeCapability } from "@/lib/ai/runtime/capability-router";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";

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
  console.log("AdeHQ SiliconFlow Runtime — V19.9.2\n");

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

  await run("missing SILICONFLOW_API_KEY marks live path unavailable", () => {
    const previous = process.env.SILICONFLOW_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    try {
      assert(!isSiliconFlowConfigured(), "expected siliconflow not configured");
      assert(!isSiliconFlowAdapterAvailable(), "expected adapter unavailable");
    } finally {
      if (previous !== undefined) process.env.SILICONFLOW_API_KEY = previous;
    }
  });

  await run("routeCapability returns fallback shape for siliconflow", async () => {
    await withEnv({ SILICONFLOW_API_KEY: "test-siliconflow-key" }, () => {
      const route = routeCapability({ capability: "structured_chat" }, "siliconflow");
      assert(route.providerRoute === "siliconflow_direct", "expected siliconflow route");
      assert(route.estimatedWorkMinutes >= 1, "expected work minute estimate");
      assert(Array.isArray(route.fallbackCandidates), "expected fallback candidates");
    });
  });

  await run("cost/work-minute estimate shape is numeric", () => {
    const minutes = estimateWorkMinutesFromCost(0.01);
    assert(minutes > 0, "expected positive minutes");
  });

  const liveKey = process.env.SILICONFLOW_API_KEY?.trim();
  if (!liveKey) {
    skip("live generateText smoke", "SKIPPED: SILICONFLOW_API_KEY not configured");
    skip("live generateObject smoke", "SKIPPED: SILICONFLOW_API_KEY not configured");
    skip("live embed smoke", "SKIPPED: SILICONFLOW_API_KEY not configured");
    skip("provider fallback shape live", "SKIPPED: SILICONFLOW_API_KEY not configured");
  } else {
    await run("[LIVE] generateText smoke via SiliconFlow", async () => {
      const adapter = createSiliconFlowAdapter();
      const result = await adapter.generateText({
        capability: "quick_reply",
        prompt: "Reply with exactly: pong",
        runtimeMode: "efficient",
        maxTokens: 16,
        timeoutMs: 30_000,
      });
      assert(typeof result.text === "string" && result.text.length > 0, "expected non-empty text");
      assert(
        (result.routing?.estimatedWorkMinutes ?? 0) >= 1,
        "expected work minute estimate on routing",
      );
    });

    await run("[LIVE] generateObject tiny schema via SiliconFlow", async () => {
      const schema = z.object({ word: z.string() });
      const adapter = createSiliconFlowAdapter();
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

    await run("[LIVE] embed smoke via SiliconFlow", async () => {
      const adapter = createSiliconFlowAdapter();
      const result = await adapter.embed({
        capability: "embedding",
        texts: ["tiny live embed probe"],
        runtimeMode: "embedding",
      });
      assert(result.embeddings.length === 1, "expected one embedding vector");
      assert(result.embeddings[0]!.length > 0, "expected non-empty embedding");
    });

    await run("[LIVE] provider fallback shape includes mock candidate", async () => {
      await withEnv({ SILICONFLOW_API_KEY: liveKey }, () => {
        const route = routeCapability({ capability: "summarization" }, "siliconflow");
        assert(
          route.fallbackCandidates.some((candidate) => candidate.providerRoute === "mock"),
          "expected mock fallback candidate",
        );
      });
    });
  }

  console.log(`\n--- Summary ---\nPASS: ${passed}  SKIP: ${skipped}  FAIL: 0  TOTAL: ${passed + skipped}`);
}

main().catch(() => {
  process.exitCode = 1;
});
