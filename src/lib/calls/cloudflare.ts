import type {
  CloudflareSessionDescription,
  CloudflareTrackDescriptor,
} from "./types";

type CloudflareResponse = {
  sessionId?: string;
  sessionDescription?: CloudflareSessionDescription;
  tracks?: Array<CloudflareTrackDescriptor & { errorCode?: string; errorDescription?: string }>;
  requiresImmediateRenegotiation?: boolean;
  errorCode?: string;
  errorDescription?: string;
};

function config() {
  const appId = process.env.CLOUDFLARE_REALTIME_APP_ID?.trim();
  const token = process.env.CLOUDFLARE_REALTIME_API_TOKEN?.trim();
  if (!appId || !token) {
    throw new Error("Cloudflare Realtime is not configured.");
  }
  return {
    appId,
    token,
    base: `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}`,
  };
}

async function request(path: string, body?: unknown, method = "POST"): Promise<CloudflareResponse> {
  const { base, token } = config();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const result = (await response.json().catch(() => ({}))) as CloudflareResponse;
  if (!response.ok || result.errorCode) {
    throw new Error(
      result.errorDescription || `Cloudflare Realtime request failed (${response.status}).`,
    );
  }
  const trackError = result.tracks?.find((track) => track.errorCode);
  if (trackError) throw new Error(trackError.errorDescription || "Cloudflare track failed.");
  return result;
}

export const cloudflareSfuAdapter = {
  backend: "cloudflare_sfu" as const,
  async createSession(description: CloudflareSessionDescription) {
    return request("/sessions/new", { sessionDescription: description });
  },
  async addTracks(
    sessionId: string,
    tracks: CloudflareTrackDescriptor[],
    description?: CloudflareSessionDescription,
  ) {
    return request(`/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
      ...(description ? { sessionDescription: description } : {}),
      tracks,
    });
  },
  async renegotiate(sessionId: string, description: CloudflareSessionDescription) {
    return request(
      `/sessions/${encodeURIComponent(sessionId)}/renegotiate`,
      { sessionDescription: description },
      "PUT",
    );
  },
  async closeTracks(sessionId: string, tracks: CloudflareTrackDescriptor[]) {
    return request(
      `/sessions/${encodeURIComponent(sessionId)}/tracks/close`,
      { tracks },
      "PUT",
    );
  },
};

export type MediaAdapter = typeof cloudflareSfuAdapter;
