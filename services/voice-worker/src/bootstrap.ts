import { CloudflareRealtimeSfuAdapter, HttpBrainApiClient } from "./boundaries.js";
import {
  CloudflareCallsApiClient,
  CloudflareCallsSignalingClient,
  type CloudflarePeerTransport,
  UnavailableCloudflarePeerTransport,
} from "./cloudflare.js";
import {
  FishStreamingTtsProvider,
  ManagedVoiceInferenceProvider,
  XaiStreamingSttProvider,
  XaiStreamingTtsProvider,
  type StreamingTtsProvider,
} from "./inference.js";
import { VoiceOrchestrator } from "./orchestrator.js";
import { VoiceWorkerRuntime, type VoiceOrchestratorFactory } from "./runtime.js";
import { LocalOnnxTurnDetector } from "./turn-detector.js";

export function createVoiceWorkerRuntime(
  env: NodeJS.ProcessEnv,
  options: {
    peerFactory?: () => CloudflarePeerTransport;
  } = {},
): VoiceWorkerRuntime {
  const xaiKey = env.XAI_API_KEY?.trim();
  const brainUrl = env.ADEHQ_BRAIN_API_BASE_URL?.trim();
  const cloudflareAppId = env.CLOUDFLARE_REALTIME_APP_ID?.trim();
  const cloudflareToken = env.CLOUDFLARE_REALTIME_API_TOKEN?.trim();
  const ttsProvider = (env.ADEHQ_LIVE_TTS_STANDARD_PROVIDER ?? "xai").toLowerCase();
  const ttsConfigured =
    ttsProvider === "xai"
      ? Boolean(xaiKey)
      : ttsProvider === "fish"
        ? Boolean(env.FISH_AUDIO_API_KEY?.trim())
        : false;
  const peerProbe = options.peerFactory?.() ?? new UnavailableCloudflarePeerTransport();
  const readiness = {
    inference: Boolean(xaiKey) && ttsConfigured,
    brain: Boolean(brainUrl),
    cloudflareApi: Boolean(cloudflareAppId && cloudflareToken),
    mediaTransport: peerProbe.configured,
  };
  void peerProbe.close("readiness_probe");

  const factory: VoiceOrchestratorFactory = {
    readiness,
    create() {
      if (!xaiKey || !brainUrl || !cloudflareAppId || !cloudflareToken) {
        throw new Error("Voice worker providers are not configured");
      }
      const peer = options.peerFactory?.() ?? new UnavailableCloudflarePeerTransport();
      const api = new CloudflareCallsApiClient(cloudflareAppId, cloudflareToken);
      const signaling = new CloudflareCallsSignalingClient(api, peer);
      const sfu = new CloudflareRealtimeSfuAdapter(signaling);
      const stt = new XaiStreamingSttProvider(
        xaiKey,
        env.XAI_STT_ENDPOINT?.trim() || undefined,
      );
      let tts: StreamingTtsProvider;
      if (ttsProvider === "fish") {
        const fishKey = env.FISH_AUDIO_API_KEY?.trim();
        if (!fishKey) throw new Error("FISH_AUDIO_API_KEY is not configured");
        tts = new FishStreamingTtsProvider(
          fishKey,
          env.FISH_AUDIO_TTS_MODEL?.trim() || undefined,
          env.FISH_AUDIO_REFERENCE_ID?.trim() || undefined,
          env.FISH_TTS_ENDPOINT?.trim() || undefined,
        );
      } else {
        tts = new XaiStreamingTtsProvider(
          xaiKey,
          env.XAI_TTS_ENDPOINT?.trim() || undefined,
        );
      }
      return new VoiceOrchestrator(
        sfu,
        new ManagedVoiceInferenceProvider(stt, tts),
        new HttpBrainApiClient(new URL(brainUrl)),
        new LocalOnnxTurnDetector(),
      );
    },
  };
  return new VoiceWorkerRuntime(factory, env.ADEHQ_WORKER_TOKEN_SECRET?.trim() ?? "");
}
