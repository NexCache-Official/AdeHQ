import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";
import { getBrainRoute } from "@/lib/brain/catalog";
import { toDataUrl } from "./normalize";
import type { NormalizedVisualAsset, VisionRouteId } from "./types";

export type VisionAdapterCallResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  modelId: string;
  routeId: VisionRouteId;
};

const SYSTEM_PROMPT = `You are AdeHQ visual understanding. Analyze the attached image(s) carefully.
Return a JSON object (and nothing else outside the JSON) with this shape:
{
  "understanding": "Clear, factual description answering the user. Cite visible text/numbers. Prefer specifics over guesses.",
  "confidence": 0.0,
  "uncertainDetails": ["things you could not read or verify"],
  "needsEscalation": false
}
Rules:
- confidence is 0–1 for how sure you are of the factual claims.
- Set needsEscalation true when text is illegible, charts are ambiguous, UI bugs need deeper reasoning, or you are guessing.
- Do not invent logos, amounts, dates, or UI labels that are not visible.
- If multiple images, refer to them as Image 1, Image 2, …`;

export async function callSiliconFlowVision(params: {
  routeId: VisionRouteId;
  userMessage: string;
  assets: NormalizedVisualAsset[];
  timeoutMs?: number;
  apiKey?: string;
  baseURL?: string;
}): Promise<VisionAdapterCallResult> {
  const route = getBrainRoute(params.routeId);
  if (!route?.model) {
    throw new Error(`Unknown vision route ${params.routeId}`);
  }
  const apiKey = (params.apiKey ?? process.env.SILICONFLOW_API_KEY)?.trim();
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY is not configured.");
  }
  const baseURL = (params.baseURL ?? SILICONFLOW_API_BASE_URL).replace(/\/$/, "");
  const enableThinking = params.routeId === "route_vision_qwen3_vl_32b_sf";

  const content: Array<Record<string, unknown>> = params.assets.map((asset) => ({
    type: "image_url",
    image_url: {
      url: toDataUrl(asset.mimeType, asset.bytes),
      detail: "high",
    },
  }));
  content.push({
    type: "text",
    text: [
      params.userMessage.trim() || "Describe what you see and extract all readable details.",
      "",
      `Images attached: ${params.assets.length}.`,
      ...params.assets.map(
        (a, i) => `Image ${i + 1}: ${a.fileName} (${a.kind}, ${a.width ?? "?"}×${a.height ?? "?"})`,
      ),
    ].join("\n"),
  });

  const body = {
    model: route.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    temperature: enableThinking ? 0.3 : 0.2,
    max_tokens: enableThinking ? 2400 : 1400,
    enable_thinking: enableThinking,
    response_format: { type: "json_object" },
  };

  const started = Date.now();
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(params.timeoutMs ?? (enableThinking ? 120_000 : 60_000)),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`SiliconFlow vision ${route.model} failed (${response.status}): ${raw.slice(0, 400)}`);
  }

  let parsed: {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error("SiliconFlow vision returned non-JSON response.");
  }

  const messageContent = parsed.choices?.[0]?.message?.content;
  let text = "";
  if (typeof messageContent === "string") {
    text = messageContent;
  } else if (Array.isArray(messageContent)) {
    text = messageContent
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }
  if (!text.trim()) {
    throw new Error("SiliconFlow vision returned empty content.");
  }

  return {
    text,
    inputTokens: Number(parsed.usage?.prompt_tokens ?? 0),
    outputTokens: Number(parsed.usage?.completion_tokens ?? 0),
    latencyMs: Date.now() - started,
    modelId: route.model,
    routeId: params.routeId,
  };
}
