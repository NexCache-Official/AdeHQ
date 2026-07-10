import { generateObject } from "ai";
import { z } from "zod";
import { siliconFlowChatModel } from "@/lib/ai/siliconflow-client";
import { DEFAULT_SILICONFLOW_MODEL } from "@/lib/config/features";

/**
 * Verifies the fix also holds for the heavier, multi-tool-call + PDF-content
 * request that previously took 105,750ms and aborted outright.
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
  console.log("Calling generateObject with the full CRM contact + deal + PDF-report prompt...\n");

  const started = Date.now();
  const result = await generateObject({
    model: siliconFlowChatModel(DEFAULT_SILICONFLOW_MODEL),
    schema,
    system:
      "You are an AI sales employee with crm.createContact, crm.createDeal, and artifact.createPdfReport tools. Respond with reply (2-3 sentences) and effects.toolCalls containing one call per requested action.",
    prompt:
      "Add a CRM contact: Marcus Webb, buyer's agent at Webb Realty Group, email marcus@webbrealty.com. " +
      "Log a deal for the Riverside Commons purchase at $7.55M in the Negotiation stage. " +
      "Then generate a one-page PDF deal summary I can send to my partners, covering the property, price, and key dates.",
    maxOutputTokens: 1800,
    abortSignal: AbortSignal.timeout(60_000),
  });
  const durationMs = Date.now() - started;

  const usage = result.usage as {
    outputTokens?: number;
    outputTokenDetails?: { textTokens?: number; reasoningTokens?: number };
  };
  const reasoningTokens = usage.outputTokenDetails?.reasoningTokens ?? 0;

  console.log(`Duration: ${durationMs}ms`);
  console.log(`Output tokens: ${usage.outputTokens}, reasoningTokens: ${reasoningTokens}`);
  console.log(`Tool calls generated: ${result.object.effects.toolCalls.map((t) => t.tool).join(", ")}`);
  console.log(`\nReply: ${result.object.reply}`);

  if (reasoningTokens > 200) {
    console.error(`\n✗ FAIL: reasoningTokens (${reasoningTokens}) still high.`);
    process.exit(1);
  }
  if (result.object.effects.toolCalls.length < 3) {
    console.error(
      `\n✗ FAIL: expected 3 tool calls (contact, deal, PDF), got ${result.object.effects.toolCalls.length}.`,
    );
    process.exit(1);
  }

  console.log(`\n✓ PASS: all 3 tool calls generated, reasoning suppressed, ${durationMs}ms (was 105,750ms and total failure before the fix).`);
}

main().catch((error) => {
  console.error("✗ FAIL:", error);
  process.exit(1);
});
