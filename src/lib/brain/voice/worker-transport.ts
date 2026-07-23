export type LiveCallsTransport = "vercel_ws" | "cloudflare_worker";

export type LiveCallsTransportDecision = {
  requested: LiveCallsTransport;
  selected: "vercel_ws";
  fallbackReason?: string;
};

/**
 * The existing browser client speaks the Vercel WebSocket event protocol.
 * Selecting the worker before a Cloudflare SFU track and client event bridge
 * exist would create a call with no usable media, so this resolver fails closed.
 */
export async function resolveLiveCallsTransport(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<LiveCallsTransportDecision> {
  const requested =
    env.ADEHQ_LIVE_CALLS_TRANSPORT?.trim().toLowerCase() === "cloudflare_worker"
      ? "cloudflare_worker"
      : "vercel_ws";
  if (requested === "vercel_ws") return { requested, selected: "vercel_ws" };

  const workerUrl = env.ADEHQ_VOICE_WORKER_URL?.trim();
  if (!workerUrl || !env.ADEHQ_WORKER_TOKEN_SECRET?.trim()) {
    return {
      requested,
      selected: "vercel_ws",
      fallbackReason: "worker_configuration_missing",
    };
  }
  try {
    const response = await fetcher(new URL("/readyz", workerUrl), {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    const status = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      cutoverReady?: boolean;
    };
    if (!response.ok || !status.ok) {
      return {
        requested,
        selected: "vercel_ws",
        fallbackReason: "worker_not_ready",
      };
    }
    // The worker can orchestrate an injected SFU track, but the current
    // Realtime Brain Calls browser has no SFU publication/event bridge yet.
    if (!status.cutoverReady) {
      return {
        requested,
        selected: "vercel_ws",
        fallbackReason: "client_sfu_bridge_not_ready",
      };
    }
    return {
      requested,
      selected: "vercel_ws",
      fallbackReason: "client_sfu_bridge_not_ready",
    };
  } catch {
    return {
      requested,
      selected: "vercel_ws",
      fallbackReason: "worker_unreachable",
    };
  }
}
