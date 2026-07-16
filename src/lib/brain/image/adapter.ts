import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";
import { getBrainRoute } from "@/lib/brain/catalog";
import type { ImageRouteId, ImageSize } from "./types";

export type SiliconFlowImageCallResult = {
  bytes: Buffer;
  mimeType: string;
  latencyMs: number;
  modelId: string;
  routeId: ImageRouteId;
  remoteUrl?: string;
  seed?: number | null;
};

function defaultSizeForRoute(routeId: ImageRouteId): ImageSize {
  if (routeId === "route_image_z_image_turbo") return "1024x1024";
  if (routeId === "route_image_qwen_image") return "1328x1328";
  if (routeId === "route_image_flux2_flex") return "1024x1024";
  return "1024x1024";
}

async function downloadImageBytes(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Failed to download generated image (${response.status}).`);
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, mimeType };
}

function decodeDataUrl(dataUrl: string): { bytes: Buffer; mimeType: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1]!,
    bytes: Buffer.from(match[2]!, "base64"),
  };
}

/**
 * SiliconFlow `/images/generations` — works for text-to-image and Qwen image edit
 * (edit passes `image` as a data URL).
 */
export async function callSiliconFlowImage(params: {
  routeId: ImageRouteId;
  prompt: string;
  negativePrompt?: string;
  imageSize?: ImageSize;
  /** data:image/...;base64,... for edit routes */
  sourceImageDataUrl?: string;
  timeoutMs?: number;
  apiKey?: string;
  baseURL?: string;
}): Promise<SiliconFlowImageCallResult> {
  const route = getBrainRoute(params.routeId);
  if (!route?.model) {
    throw new Error(`Unknown image route ${params.routeId}`);
  }
  const apiKey = (params.apiKey ?? process.env.SILICONFLOW_API_KEY)?.trim();
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY is not configured.");
  }
  const baseURL = (params.baseURL ?? SILICONFLOW_API_BASE_URL).replace(/\/$/, "");

  const body: Record<string, unknown> = {
    model: route.model,
    prompt: params.prompt,
    batch_size: 1,
    output_format: "png",
  };

  if (params.negativePrompt?.trim()) {
    body.negative_prompt = params.negativePrompt.trim();
  }

  const isEdit = params.routeId === "route_image_qwen_image_edit";
  if (isEdit) {
    if (!params.sourceImageDataUrl) {
      throw new Error("Image edit requires a source image.");
    }
    body.image = params.sourceImageDataUrl;
    // Qwen-Image-Edit does not support image_size per SF docs.
  } else {
    body.image_size = params.imageSize ?? defaultSizeForRoute(params.routeId);
  }

  if (params.routeId === "route_image_qwen_image") {
    body.num_inference_steps = 28;
    body.cfg = 4.0;
  }
  if (params.routeId === "route_image_flux2_flex") {
    body.num_inference_steps = 28;
  }

  const started = Date.now();
  const response = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(params.timeoutMs ?? 120_000),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `SiliconFlow image generation failed (${response.status}): ${raw.slice(0, 400)}`,
    );
  }

  let parsed: {
    images?: Array<{ url?: string; image?: string; b64_json?: string }>;
    data?: Array<{ url?: string; b64_json?: string }>;
    seed?: number;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error("SiliconFlow image API returned non-JSON.");
  }

  const first =
    parsed.images?.[0] ??
    parsed.data?.[0] ??
    null;
  if (!first) {
    throw new Error("SiliconFlow image API returned no images.");
  }

  let bytes: Buffer;
  let mimeType = "image/png";
  let remoteUrl: string | undefined;

  if (typeof first.url === "string" && first.url.startsWith("http")) {
    remoteUrl = first.url;
    const downloaded = await downloadImageBytes(first.url);
    bytes = downloaded.bytes;
    mimeType = downloaded.mimeType;
  } else if (typeof first.url === "string" && first.url.startsWith("data:")) {
    const decoded = decodeDataUrl(first.url);
    if (!decoded) throw new Error("Invalid data URL from image API.");
    bytes = decoded.bytes;
    mimeType = decoded.mimeType;
  } else if (typeof first.image === "string") {
    const decoded = decodeDataUrl(first.image) ?? {
      bytes: Buffer.from(first.image, "base64"),
      mimeType: "image/png",
    };
    bytes = decoded.bytes;
    mimeType = decoded.mimeType;
  } else if (typeof first.b64_json === "string") {
    bytes = Buffer.from(first.b64_json, "base64");
  } else {
    throw new Error("SiliconFlow image payload missing url/base64.");
  }

  return {
    bytes,
    mimeType,
    latencyMs: Date.now() - started,
    modelId: route.model,
    routeId: params.routeId,
    remoteUrl,
    seed: typeof parsed.seed === "number" ? parsed.seed : null,
  };
}
