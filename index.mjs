/**
 * Quick Vercel AI Gateway smoke script.
 *
 * Run: node --env-file=.env.local index.mjs
 *
 * Uses AI_GATEWAY_API_KEY from .env.local, or VERCEL_OIDC_TOKEN after `vc env pull`.
 */
import { streamText } from "ai";
import { gateway } from "@ai-sdk/gateway";

const result = streamText({
  model: gateway("openai/gpt-5.5"),
  prompt: "Explain quantum computing in simple terms.",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}

process.stdout.write("\n");
