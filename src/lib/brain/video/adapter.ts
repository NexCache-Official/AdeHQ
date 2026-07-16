import { SILICONFLOW_API_BASE_URL } from "@/lib/config/features";
import { getBrainRoute } from "@/lib/brain/catalog";
import type { VideoRouteId, VideoSize } from "./types";

export type SiliconFlowVideoSubmitResult = {
  requestId: string;
  routeId: VideoRouteId;
  modelId: string;
};

export type SiliconFlowVideoStatus =
  | "Succeed"
  | "InQueue"
  | "InProgress"
  | "Failed";

export type SiliconFlowVideoStatusResult = {
  status: SiliconFlowVideoStatus;
  reason?: string;
  videoUrl?: string;
  seed?: number | null;
  inferenceSeconds?: number | null;
};

function defaultSize(): VideoSize {
  return "1280x720";
}

export async function submitSiliconFlowVideo(params: {
  routeId: VideoRouteId;
  prompt: string;
  negativePrompt?: string;
  imageSize?: VideoSize;
  /** data:image/...;base64,... required for I2V */
  sourceImageDataUrl?: string;
  apiKey?: string;
  baseURL?: string;
}): Promise<SiliconFlowVideoSubmitResult> {
  const route = getBrainRoute(params.routeId);
  if (!route?.model) throw new Error(`Unknown video route ${params.routeId}`);
  const apiKey = (params.apiKey ?? process.env.SILICONFLOW_API_KEY)?.trim();
  if (!apiKey) throw new Error("SILICONFLOW_API_KEY is not configured.");
  const baseURL = (params.baseURL ?? SILICONFLOW_API_BASE_URL).replace(/\/$/, "");

  const isI2v = params.routeId === "route_video_wan22_i2v";
  if (isI2v && !params.sourceImageDataUrl) {
    throw new Error("Image-to-video requires a source image.");
  }

  const body: Record<string, unknown> = {
    model: route.model,
    prompt: params.prompt,
    image_size: params.imageSize ?? defaultSize(),
  };
  if (params.negativePrompt?.trim()) {
    body.negative_prompt = params.negativePrompt.trim();
  }
  if (isI2v) {
    body.image = params.sourceImageDataUrl;
  }

  const response = await fetch(`${baseURL}/video/submit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`SiliconFlow video submit failed (${response.status}): ${raw.slice(0, 400)}`);
  }
  let parsed: { requestId?: string; request_id?: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error("SiliconFlow video submit returned non-JSON.");
  }
  const requestId = parsed.requestId ?? parsed.request_id;
  if (!requestId) throw new Error("SiliconFlow video submit missing requestId.");
  return { requestId, routeId: params.routeId, modelId: route.model };
}

export async function getSiliconFlowVideoStatus(params: {
  requestId: string;
  apiKey?: string;
  baseURL?: string;
}): Promise<SiliconFlowVideoStatusResult> {
  const apiKey = (params.apiKey ?? process.env.SILICONFLOW_API_KEY)?.trim();
  if (!apiKey) throw new Error("SILICONFLOW_API_KEY is not configured.");
  const baseURL = (params.baseURL ?? SILICONFLOW_API_BASE_URL).replace(/\/$/, "");

  const response = await fetch(`${baseURL}/video/status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestId: params.requestId }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`SiliconFlow video status failed (${response.status}): ${raw.slice(0, 400)}`);
  }
  let parsed: {
    status?: string;
    reason?: string;
    results?: {
      videos?: Array<{ url?: string }>;
      timings?: { inference?: number };
      seed?: number;
    };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error("SiliconFlow video status returned non-JSON.");
  }
  const status = (parsed.status ?? "Failed") as SiliconFlowVideoStatusResult["status"];
  return {
    status,
    reason: parsed.reason,
    videoUrl: parsed.results?.videos?.[0]?.url,
    seed: typeof parsed.results?.seed === "number" ? parsed.results.seed : null,
    inferenceSeconds:
      typeof parsed.results?.timings?.inference === "number"
        ? parsed.results.timings.inference
        : null,
  };
}

export async function downloadVideoBytes(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Failed to download generated video (${response.status}).`);
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, mimeType };
}

/**
 * Poll until Succeed/Failed or cancel/timeout.
 * SF has no public cancel endpoint — cancel is local (stop waiting + mark cancelled).
 */
export async function pollSiliconFlowVideoUntilDone(params: {
  requestId: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  shouldCancel?: () => Promise<boolean>;
  onStatus?: (status: SiliconFlowVideoStatus) => void | Promise<void>;
}): Promise<SiliconFlowVideoStatusResult> {
  const pollIntervalMs = params.pollIntervalMs ?? 5_000;
  const maxWaitMs = params.maxWaitMs ?? Number(process.env.ADEHQ_VIDEO_POLL_MAX_MS ?? 480_000);
  const started = Date.now();

  while (Date.now() - started < maxWaitMs) {
    if (params.shouldCancel && (await params.shouldCancel())) {
      return { status: "Failed", reason: "cancelled" };
    }
    const status = await getSiliconFlowVideoStatus({ requestId: params.requestId });
    await params.onStatus?.(status.status);
    if (status.status === "Succeed" || status.status === "Failed") {
      return status;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return { status: "Failed", reason: "timed_out_waiting_for_video" };
}
