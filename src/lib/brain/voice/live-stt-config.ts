export type StreamingSttProvider = "xai" | "deepgram" | "moonshine";

export type StreamingSttRouteContract = {
  provider: StreamingSttProvider;
  role: "active" | "shadow";
  transport: "managed_websocket" | "worker_websocket";
  emitsPartials: true;
  localTurnCommit: true;
};

export const LIVE_STT_MEDIA_BOUNDARY = {
  encoding: "pcm_s16le",
  sampleRate: 16_000,
  channels: 1,
  preRollMs: 200,
  // Once local VAD opens the gate, forward speech plus the trailing silence
  // used by local turn detection. Never forward continuous room audio while idle.
  // Keep in sync with DEFAULT_TURN_DETECTION_POLICY.hardTimeoutMs.
  maximumTrailingSilenceMs: 1800,
} as const;

const SUPPORTED_PROVIDERS = new Set<StreamingSttProvider>([
  "xai",
  "deepgram",
  "moonshine",
]);

function providerList(raw?: string): StreamingSttProvider[] {
  return Array.from(
    new Set(
      (raw ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is StreamingSttProvider =>
          SUPPORTED_PROVIDERS.has(value as StreamingSttProvider),
        ),
    ),
  );
}

/**
 * Provider-neutral routing contract. Only xAI is active today; Deepgram and
 * Moonshine may be declared as shadow candidates for benchmark/telemetry
 * configuration, but this module deliberately does not call them.
 */
export function resolveStreamingSttRoutes(
  env: NodeJS.ProcessEnv = process.env,
): StreamingSttRouteContract[] {
  const active = (env.ADEHQ_LIVE_STT_PROVIDER ?? "xai").trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(active as StreamingSttProvider)) {
    throw new Error(`Unsupported live STT provider: ${active || "(empty)"}.`);
  }
  if (active !== "xai") {
    throw new Error(
      `${active} live STT is a shadow-route contract only; xai is the only active provider.`,
    );
  }
  const shadows = providerList(env.ADEHQ_LIVE_STT_SHADOW_PROVIDERS).filter(
    (provider) => provider !== active,
  );
  return [
    {
      provider: "xai",
      role: "active",
      transport: "managed_websocket",
      emitsPartials: true,
      localTurnCommit: true,
    },
    ...shadows.map(
      (provider): StreamingSttRouteContract => ({
        provider,
        role: "shadow",
        transport:
          provider === "moonshine" ? "worker_websocket" : "managed_websocket",
        emitsPartials: true,
        localTurnCommit: true,
      }),
    ),
  ];
}

export function streamingSttConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const active = resolveStreamingSttRoutes(env).find(
      (route) => route.role === "active",
    );
    return active?.provider === "xai" && Boolean(env.XAI_API_KEY?.trim());
  } catch {
    return false;
  }
}
