/**
 * V19.9.2 — Runtime integration smoke tests across mock + optional live providers.
 *
 * Usage: npm run test:runtime:integration
 */

import { z } from "zod";
import { generateObject as runtimeGenerateObject, generateText as runtimeGenerateText, embed } from "@/lib/ai/runtime";
import { routeCapability } from "@/lib/ai/runtime/capability-router";
import { createSiliconFlowAdapter, isSiliconFlowAdapterAvailable } from "@/lib/ai/runtime/adapters/siliconflow";
import {
  createVercelGatewayAdapter,
  isVercelGatewayAdapterAvailable,
} from "@/lib/ai/runtime/adapters/vercel-gateway";
import { buildIntelligencePolicyForHire, formatIntelligencePolicyLines } from "@/lib/ai/intelligence-policy";
import { evaluateSoftCapSimulation } from "@/lib/ai/work-hours/soft-cap-simulation";

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
  console.log("AdeHQ Runtime Integration — V19.9.2\n");

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

  await run("mock provider — topic summary structured object", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        const schema = z.object({ summary: z.string() });
        const result = await runtimeGenerateObject({
          capability: "summarization",
          prompt: "Summarize: team agreed to ship calibration UI.",
          schema,
        }, { forceMode: "on" });
        assert(schema.safeParse(result.object).success, "summary schema invalid");
      },
    );
  });

  await run("mock provider — classifier structured object", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        const schema = z.object({ shouldRespond: z.boolean() });
        const result = await runtimeGenerateObject({
          capability: "classification",
          prompt: "Decide if orchestration should respond.",
          schema,
        }, { forceMode: "on" });
        assert(schema.safeParse(result.object).success, "classifier schema invalid");
      },
    );
  });

  await run("mock provider — hiring candidate copy text", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        const result = await runtimeGenerateText({
          capability: "structured_chat",
          prompt: "Write one sentence candidate pitch.",
        }, { forceMode: "on" });
        assert(typeof result.text === "string" && result.text.length > 0, "expected candidate copy");
      },
    );
  });

  await run("mock provider — file embedding vectors", async () => {
    await withEnv(
      { AI_RUNTIME_V2_MODE: "on", AI_RUNTIME_V2_PROVIDER_PREF: "mock" },
      async () => {
        const result = await embed({
          capability: "embedding",
          texts: ["file chunk"],
        }, { forceMode: "on" });
        assert(result.embeddings.length === 1, "expected embedding vector");
      },
    );
  });

  await run("intelligence policy UX helpers produce user-facing labels", () => {
    const policy = buildIntelligencePolicyForHire({ modelMode: "balanced" });
    const lines = formatIntelligencePolicyLines(policy);
    assert(lines.some((line) => line.label === "Intelligence"), "expected intelligence line");
    assert(!lines.some((line) => line.value.includes("deepseek")), "should hide raw model names");
  });

  await run("soft-cap simulation remains shadow-only in integration path", () => {
    const result = evaluateSoftCapSimulation({
      workspaceId: "ws_test",
      weekStart: "2026-07-06",
      usedMinutes: 650,
      estimatedNextRunMinutes: 5,
    });
    assert(result.shadowOnly === true, "simulation must remain shadow-only");
  });

  if (!process.env.SILICONFLOW_API_KEY?.trim() || !isSiliconFlowAdapterAvailable()) {
    skip("siliconflow live smoke", "SKIPPED: SILICONFLOW_API_KEY not configured");
  } else {
    await run("siliconflow live — tiny generateText/object/embed", async () => {
      const adapter = createSiliconFlowAdapter();
      const text = await adapter.generateText({
        capability: "quick_reply",
        prompt: "Reply with exactly: ok",
        runtimeMode: "efficient",
        maxTokens: 8,
        timeoutMs: 30_000,
      });
      assert(typeof text.text === "string" && text.text.length > 0, "expected siliconflow text");

      const schema = z.object({ ok: z.boolean() });
      const object = await adapter.generateObject({
        capability: "classification",
        prompt: 'Return {"ok":true}',
        schema,
        runtimeMode: "efficient",
        maxTokens: 16,
        timeoutMs: 30_000,
      });
      assert(schema.safeParse(object.object).success, "expected siliconflow object");

      const vectors = await adapter.embed({
        capability: "embedding",
        texts: ["probe"],
        runtimeMode: "embedding",
      });
      assert(vectors.embeddings[0]!.length > 0, "expected siliconflow embedding");
    });
  }

  if (!process.env.AI_GATEWAY_API_KEY?.trim() || !isVercelGatewayAdapterAvailable()) {
    skip("vercel live smoke", "SKIPPED: AI_GATEWAY_API_KEY not configured");
  } else {
    await run("vercel live — tiny generateText/object/embed", async () => {
      const adapter = createVercelGatewayAdapter();
      const text = await adapter.generateText({
        capability: "quick_reply",
        prompt: "Reply with exactly: ok",
        runtimeMode: "efficient",
        maxTokens: 8,
        timeoutMs: 30_000,
      });
      assert(typeof text.text === "string" && text.text.length > 0, "expected vercel text");

      const schema = z.object({ ok: z.boolean() });
      const object = await adapter.generateObject({
        capability: "classification",
        prompt: 'Return {"ok":true}',
        schema,
        runtimeMode: "efficient",
        maxTokens: 16,
        timeoutMs: 30_000,
      });
      assert(schema.safeParse(object.object).success, "expected vercel object");

      const vectors = await adapter.embed({
        capability: "embedding",
        texts: ["probe"],
        runtimeMode: "embedding",
      });
      assert(vectors.embeddings[0]!.length > 0, "expected vercel embedding");
    });
  }

  await run("routeCapability preview shape for structured chat", () => {
    const route = routeCapability({ capability: "structured_chat" }, "auto");
    assert(route.providerRoute.length > 0, "expected provider route");
    assert(route.estimatedWorkMinutes >= 1, "expected work minutes");
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  SKIP: ${skipped}  FAIL: 0  TOTAL: ${passed + skipped}`);
}

main().catch(() => {
  process.exitCode = 1;
});
