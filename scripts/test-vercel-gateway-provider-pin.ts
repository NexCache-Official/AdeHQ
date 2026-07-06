/**
 * V20.1.1 — Vercel Gateway provider pin smoke test.
 *
 * Verifies gatewayProviderSlug flows into providerOptions.gateway.only on generateText/generateObject.
 */

import { z } from "zod";
import {
  buildGatewayProviderOptions,
  createVercelGatewayAdapter,
} from "@/lib/ai/runtime/adapters/vercel-gateway";
import type { RuntimeGenerateObjectParams, RuntimeGenerateTextParams } from "@/lib/ai/runtime/types";

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

async function main() {
  await run("buildGatewayProviderOptions pins blackbox", () => {
    const opts = buildGatewayProviderOptions("blackbox");
    assert(opts != null, "options required for blackbox");
    assert(JSON.stringify(opts) === JSON.stringify({ gateway: { only: ["blackbox"] } }), "gateway.only");
  });

  await run("buildGatewayProviderOptions skips default slug", () => {
    assert(buildGatewayProviderOptions("default") === undefined, "default unpinned");
    assert(buildGatewayProviderOptions(undefined) === undefined, "undefined unpinned");
  });

  let capturedTextOptions: unknown;
  let capturedObjectOptions: unknown;

  const adapter = createVercelGatewayAdapter({
    generateText: async (params: RuntimeGenerateTextParams) => {
      capturedTextOptions = buildGatewayProviderOptions(params.gatewayProviderSlug);
      return "ok";
    },
    generateObject: async <T>(params: RuntimeGenerateObjectParams<T>) => {
      capturedObjectOptions = buildGatewayProviderOptions(params.gatewayProviderSlug);
      return { ok: true } as T;
    },
  });

  await run("generateText sends gateway.only for minimax/blackbox", async () => {
    await adapter.generateText({
      capability: "long_context",
      prompt: "hi",
      modelId: "minimax/minimax-m2.5",
      gatewayProviderSlug: "blackbox",
      endpointKey: "vercel_gateway:minimax/minimax-m2.5:blackbox",
    });
    assert(
      JSON.stringify(capturedTextOptions) === JSON.stringify({ gateway: { only: ["blackbox"] } }),
      `expected gateway.only blackbox, got ${JSON.stringify(capturedTextOptions)}`,
    );
  });

  await run("generateObject sends gateway.only for deepseek", async () => {
    await adapter.generateObject({
      capability: "deep_reasoning",
      prompt: "hi",
      schema: z.object({ ok: z.boolean() }),
      modelId: "deepseek/deepseek-v4-pro",
      gatewayProviderSlug: "deepseek",
    });
    assert(
      JSON.stringify(capturedObjectOptions) === JSON.stringify({ gateway: { only: ["deepseek"] } }),
      `expected gateway.only deepseek, got ${JSON.stringify(capturedObjectOptions)}`,
    );
  });

  console.log("\nAll Vercel gateway provider pin tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
