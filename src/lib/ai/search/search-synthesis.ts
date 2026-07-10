import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { siliconFlowChatModel } from "@/lib/ai/siliconflow-client";
import { resolveModel, getOutputTokenCap } from "@/lib/ai/model-catalog";
import { SILICONFLOW_CHEAP_MODEL } from "@/lib/config/features";
import {
  getFastFactSearchPreset,
  getGatewaySearchModelId,
  isGatewaySearchConfigured,
} from "./config";
import { resolveVercelGatewayModelId } from "@/lib/ai/runtime/adapters/vercel-models";
import type { SearchMode, SearchSource } from "./types";

export function buildSynthesisPromptFromSources(
  query: string,
  sources: SearchSource[],
  employeeName?: string,
  searchMode: SearchMode = "standard",
): string {
  const who = employeeName ? `${employeeName} (AI employee)` : "An AdeHQ AI employee";
  const sourceBlock = sources
    .map((source, index) => {
      const lines = [`[${index + 1}] ${source.title}`, `URL: ${source.url}`];
      if (source.snippet?.trim()) lines.push(source.snippet.trim().slice(0, 500));
      return lines.join("\n");
    })
    .join("\n\n");

  const lengthHint =
    searchMode === "fast_fact"
      ? "Answer in 2-4 short paragraphs max."
      : "Answer concisely in plain language (2-5 short paragraphs max).";

  return [
    `${who} is answering a factual question using numbered web sources.`,
    "",
    `Question: ${query.trim()}`,
    "",
    "Sources:",
    sourceBlock || "(no sources returned)",
    "",
    "Instructions:",
    `- ${lengthHint}`,
    "- Cite sources inline after each factual claim using [1], [2], etc. matching the numbered sources above.",
    "- Only state facts that are supported by the numbered sources.",
    "- For private companies, distinguish revenue vs ARR vs run-rate; say estimated/reported when appropriate.",
    "- If sources disagree, give a range and cite each supporting source.",
    "- Do not add a separate Sources section — source links are shown separately in the UI.",
    "- If the sources do not support an answer, say you could not verify from current sources.",
  ].join("\n");
}

export async function synthesizeAnswerFromSources(options: {
  query: string;
  sources: SearchSource[];
  employeeName?: string;
  searchMode?: SearchMode;
  timeoutMs?: number;
}): Promise<{ text: string; synthesisModel: string; synthesisLatencyMs: number }> {
  const preset = getFastFactSearchPreset();
  const searchMode = options.searchMode ?? "standard";
  const prompt = buildSynthesisPromptFromSources(
    options.query,
    options.sources,
    options.employeeName,
    searchMode,
  );
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? preset.timeoutMs;

  if (isGatewaySearchConfigured()) {
    const modelId =
      resolveVercelGatewayModelId({ runtimeMode: "efficient" }) || getGatewaySearchModelId();
    const result = await generateText({
      model: gateway(modelId),
      prompt,
      maxOutputTokens: preset.synthesisMaxOutputTokens,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return {
      text: result.text.trim(),
      synthesisModel: modelId,
      synthesisLatencyMs: Date.now() - started,
    };
  }

  const model = resolveModel("siliconflow", "cheap", SILICONFLOW_CHEAP_MODEL);
  const result = await generateText({
    model: siliconFlowChatModel(model),
    prompt,
    maxOutputTokens: Math.min(900, getOutputTokenCap("cheap")),
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  return {
    text: result.text.trim(),
    synthesisModel: model,
    synthesisLatencyMs: Date.now() - started,
  };
}
