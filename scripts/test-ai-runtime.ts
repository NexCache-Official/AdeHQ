/**
 * V19.9.0a — AI Runtime V2 smoke tests (mock provider).
 * Does not change production behavior — tests force runtime mode on.
 *
 * Usage: npm run test:runtime:mock
 */

import { z } from "zod";
import {
  generateObject,
  generateText,
  getRuntimeFlags,
  planRoute,
  RuntimeDisabledError,
} from "@/lib/ai/runtime";

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

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("AdeHQ AI Runtime V2 — mock smoke tests (V19.9.0a)\n");

  let passed = 0;

  const run = async (name: string, fn: () => void | Promise<void>) => {
    await test(name, fn);
    passed += 1;
  };

  await run("flags default to off/auto when env unset", () => {
    const prevMode = process.env.AI_RUNTIME_V2_MODE;
    const prevPref = process.env.AI_RUNTIME_V2_PROVIDER_PREF;
    delete process.env.AI_RUNTIME_V2_MODE;
    delete process.env.AI_RUNTIME_V2_PROVIDER_PREF;
    delete process.env.AI_RUNTIME_V2_ENABLED;
    delete process.env.AI_RUNTIME_V2_SHADOW_MODE;

    const flags = getRuntimeFlags();
    assert(flags.mode === "off", `expected off, got ${flags.mode}`);
    assert(flags.providerPref === "auto", `expected auto, got ${flags.providerPref}`);

    if (prevMode === undefined) delete process.env.AI_RUNTIME_V2_MODE;
    else process.env.AI_RUNTIME_V2_MODE = prevMode;
    if (prevPref === undefined) delete process.env.AI_RUNTIME_V2_PROVIDER_PREF;
    else process.env.AI_RUNTIME_V2_PROVIDER_PREF = prevPref;
  });

  await run("legacy AI_RUNTIME_V2_SHADOW_MODE=true normalizes to shadow", () => {
    const prevMode = process.env.AI_RUNTIME_V2_MODE;
    const prevShadow = process.env.AI_RUNTIME_V2_SHADOW_MODE;
    delete process.env.AI_RUNTIME_V2_MODE;
    process.env.AI_RUNTIME_V2_SHADOW_MODE = "true";

    const flags = getRuntimeFlags();
    assert(flags.mode === "shadow", `expected shadow, got ${flags.mode}`);

    if (prevMode === undefined) delete process.env.AI_RUNTIME_V2_MODE;
    else process.env.AI_RUNTIME_V2_MODE = prevMode;
    if (prevShadow === undefined) delete process.env.AI_RUNTIME_V2_SHADOW_MODE;
    else process.env.AI_RUNTIME_V2_SHADOW_MODE = prevShadow;
  });

  await run("generateText throws when mode=off", async () => {
    let threw = false;
    try {
      await generateText(
        { capability: "quick_reply", prompt: "hello" },
        { forceMode: "off" },
      );
    } catch (error) {
      threw = error instanceof RuntimeDisabledError;
    }
    assert(threw, "expected RuntimeDisabledError");
  });

  await run("shadow mode returns planned route without executing provider", async () => {
    const result = await generateText(
      { capability: "summarization", prompt: "Summarize this topic." },
      { forceMode: "shadow", forceProviderPref: "mock" },
    );

    assert(result.shadow === true, "expected shadow=true");
    assert(Boolean(result.routing?.modelId), "expected routing.modelId");
    assert(result.finishReason === "shadow", "expected finishReason=shadow");
    assert(result.text === undefined, "shadow must not return provider text");
  });

  await run("mock generateText returns deterministic prefix", async () => {
    const result = await generateText(
      { capability: "classification", prompt: "Classify this message" },
      { forceMode: "on", forceProviderPref: "mock" },
    );

    assert(result.usage.providerRoute === "mock", "expected mock route");
    assert(
      typeof result.text === "string" && result.text.includes("[mock:classification]"),
      "expected mock text prefix",
    );
  });

  await run("mock generateObject returns schema-shaped object", async () => {
    const schema = z.object({
      label: z.string(),
      score: z.number(),
    });

    const result = await generateObject(
      { capability: "classification", prompt: "Score this", schema },
      { forceMode: "on", forceProviderPref: "mock" },
    );

    const parsed = schema.safeParse(result.object);
    assert(parsed.success, "object must match schema");
  });

  await run("capability router plans summarization route", () => {
    const route = planRoute(
      { capability: "summarization", message: "weekly report" },
      { forceMode: "shadow", forceProviderPref: "auto" },
    );
    assert(
      route.providerRoute === "siliconflow_direct" || route.providerRoute === "mock",
      `unexpected route ${route.providerRoute}`,
    );
    assert(route.capability === "summarization", "capability mismatch");
  });

  console.log(`\n--- Summary ---\nPASS: ${passed}  FAIL: 0  TOTAL: ${passed}`);
}

main().catch(() => {
  process.exitCode = 1;
});
