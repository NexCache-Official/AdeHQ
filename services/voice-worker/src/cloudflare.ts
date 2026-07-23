import type { AudioFrame } from "./contracts.js";
import type {
  CloudflareRealtimeSignaling,
  SfuTrackRef,
} from "./boundaries.js";

export interface SessionDescription {
  type: "offer" | "answer";
  sdp: string;
}

type CallsResponse = {
  sessionId?: string;
  sessionDescription?: SessionDescription;
  errorCode?: string;
  errorDescription?: string;
  requiresImmediateRenegotiation?: boolean;
};

export class CloudflareCallsApiClient {
  readonly #baseUrl: string;

  constructor(appId: string, private readonly apiToken: string) {
    this.#baseUrl = `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}`;
  }

  createSession(description: SessionDescription, signal: AbortSignal): Promise<CallsResponse> {
    return this.#request("/sessions/new", "POST", { sessionDescription: description }, signal);
  }

  addTracks(
    sessionId: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallsResponse> {
    return this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/tracks/new`,
      "POST",
      body,
      signal,
    );
  }

  renegotiate(
    sessionId: string,
    description: SessionDescription,
    signal: AbortSignal,
  ): Promise<CallsResponse> {
    return this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/renegotiate`,
      "PUT",
      { sessionDescription: description },
      signal,
    );
  }

  closeTracks(
    sessionId: string,
    tracks: Array<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<CallsResponse> {
    return this.#request(
      `/sessions/${encodeURIComponent(sessionId)}/tracks/close`,
      "PUT",
      { tracks },
      signal,
    );
  }

  async #request(
    path: string,
    method: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<CallsResponse> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    const result = (await response.json().catch(() => ({}))) as CallsResponse;
    if (!response.ok || result.errorCode) {
      throw new Error(
        result.errorDescription ?? `Cloudflare Calls API failed with HTTP ${response.status}`,
      );
    }
    return result;
  }
}

/**
 * The Calls API is signaling only. This contract owns RTCPeerConnection and
 * encoded audio extraction/injection. A Node native WebRTC implementation or an
 * external media bridge must implement it.
 */
export interface CloudflarePeerTransport {
  readonly id: string;
  readonly configured: boolean;
  createOffer(signal: AbortSignal): Promise<SessionDescription>;
  acceptAnswer(description: SessionDescription, signal: AbortSignal): Promise<void>;
  subscribe(
    api: CloudflareCallsApiClient,
    localSessionId: string,
    track: SfuTrackRef,
    signal: AbortSignal,
  ): AsyncIterable<AudioFrame>;
  publish(
    api: CloudflareCallsApiClient,
    localSessionId: string,
    trackName: string,
    frames: AsyncIterable<AudioFrame>,
    signal: AbortSignal,
  ): Promise<void>;
  close(reason: string): Promise<void>;
}

export class CloudflareCallsSignalingClient implements CloudflareRealtimeSignaling {
  #sessionId?: string;

  constructor(
    private readonly api: CloudflareCallsApiClient,
    readonly peer: CloudflarePeerTransport,
  ) {}

  async createSession(signal: AbortSignal): Promise<{ sessionId: string }> {
    if (!this.peer.configured) throw new Error("Cloudflare peer media transport is unavailable");
    const offer = await this.peer.createOffer(signal);
    const result = await this.api.createSession(offer, signal);
    if (!result.sessionId || !result.sessionDescription) {
      throw new Error("Cloudflare Calls API returned an incomplete session");
    }
    await this.peer.acceptAnswer(result.sessionDescription, signal);
    this.#sessionId = result.sessionId;
    return { sessionId: result.sessionId };
  }

  subscribeTrack(track: SfuTrackRef, signal: AbortSignal): AsyncIterable<AudioFrame> {
    if (!this.#sessionId) throw new Error("Cloudflare session is not connected");
    return this.peer.subscribe(this.api, this.#sessionId, track, signal);
  }

  publishTrack(
    trackName: string,
    frames: AsyncIterable<AudioFrame>,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.#sessionId) throw new Error("Cloudflare session is not connected");
    return this.peer.publish(this.api, this.#sessionId, trackName, frames, signal);
  }

  async closeSession(sessionId: string, reason: string): Promise<void> {
    if (sessionId !== this.#sessionId) return;
    this.#sessionId = undefined;
    await this.peer.close(reason);
  }
}

export class UnavailableCloudflarePeerTransport implements CloudflarePeerTransport {
  readonly id = "unavailable";
  readonly configured = false;

  createOffer(): Promise<SessionDescription> {
    return Promise.reject(new Error("No Node WebRTC peer transport is configured"));
  }
  acceptAnswer(): Promise<void> {
    return Promise.reject(new Error("No Node WebRTC peer transport is configured"));
  }
  async *subscribe(): AsyncIterable<AudioFrame> {
    throw new Error("No Node WebRTC peer transport is configured");
  }
  publish(): Promise<void> {
    return Promise.reject(new Error("No Node WebRTC peer transport is configured"));
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
