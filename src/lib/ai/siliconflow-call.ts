import { createOpenAI } from "@ai-sdk/openai";
import { callStructuredLlm, type StructuredLlmResult } from "./structured-llm-call";

const siliconflow = createOpenAI({
  apiKey: process.env.SILICONFLOW_API_KEY,
  baseURL: "https://api.siliconflow.com/v1",
});

export type SiliconFlowCallResult = StructuredLlmResult & {
  model: string;
};

export async function callSiliconFlowEmployee(
  system: string,
  prompt: string,
  model: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<SiliconFlowCallResult> {
  const result = await callStructuredLlm({
    model: siliconflow(model),
    system,
    prompt,
    maxTokens,
    timeoutMs,
  });

  return { ...result, model };
}
