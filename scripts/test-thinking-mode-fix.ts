import { generateObject } from "ai";
import { z } from "zod";
import { siliconFlowChatModel } from "@/lib/ai/siliconflow-client";
import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";

/**
 * Direct verification that the fetch-layer thinking-mode fix actually reaches
 * SiliconFlow: runs the exact call shape that was failing (generateObject with a
 * structured schema, on the default DeepSeek model) and checks the real usage
 * breakdown for reasoningTokens vs textTokens. Before the fix, this model burned
 * ~1400/1400 output tokens on reasoning and produced finishReason "length" with
 * NoObjectGeneratedError. After the fix, reasoning should drop to ~0 and the
 * object should generate successfully well within budget.
 */
async function main() {
  const schema = z.object({
    reply: z.string(),
    effects: z.object({
      toolCalls: z.array(
        z.object({
          tool: z.string(),
          mode: z.enum(["execute", "preview"]),
          args: z.record(z.string(), z.unknown()),
        }),
      ),
    }),
  });

  console.log(`Model: ${DEFAULT_SILICONFLOW_MODEL}`);
  console.log("Calling generateObject with a CRM-style tool-calling prompt...\n");

  const started = Date.now();
  const result = await generateObject({
    model: siliconFlowChatModel(DEFAULT_SILICONFLOW_MODEL),
    schema,
    system:
      "You are an AI sales employee. Respond with reply (one sentence) and effects.toolCalls containing exactly one crm.createContact call.",
    prompt:
      "Add a CRM contact: Marcus Webb, buyer's agent at Webb Realty Group, email marcus@webbrealty.com.",
    maxOutputTokens: 1400,
    abortSignal: AbortSignal.timeout(60_000),
  });
  const durationMs = Date.now() - started;

  const usage = result.usage as {
    outputTokens?: number;
    outputTokenDetails?: { textTokens?: number; reasoningTokens?: number };
  };
  const reasoningTokens = usage.outputTokenDetails?.reasoningTokens ?? 0;
  const textTokens = usage.outputTokenDetails?.textTokens ?? 0;

  console.log(`Duration: ${durationMs}ms`);
  console.log(`Output tokens: ${usage.outputTokens}`);
  console.log(`  reasoningTokens: ${reasoningTokens}`);
  console.log(`  textTokens: ${textTokens}`);
  console.log(`\nParsed object:`, JSON.stringify(result.object, null, 2));

  if (reasoningTokens > 200) {
    console.error(
      `\n✗ FAIL: reasoningTokens (${reasoningTokens}) still high — thinking mode is not being suppressed.`,
    );
    process.exit(1);
  }
  if (!result.object.effects.toolCalls.length) {
    console.error(`\n✗ FAIL: no tool calls were generated.`);
    process.exit(1);
  }

  console.log(`\n✓ PASS: reasoning tokens suppressed (${reasoningTokens}), tool call generated, ${durationMs}ms.`);
}

main().catch((error) => {
  console.error("✗ FAIL:", error);
  process.exit(1);
});
