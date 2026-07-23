import type { AudioFrame, TranscriptFrame } from "./contracts.js";

export interface SfuTrackRef {
  sessionId: string;
  trackName: string;
}

export interface SfuMediaAdapter {
  readonly id: string;
  connect(input: {
    callId: string;
    participantId: string;
    workerToken: string;
    signal: AbortSignal;
  }): Promise<void>;
  subscribe(track: SfuTrackRef, signal: AbortSignal): AsyncIterable<AudioFrame>;
  publish(frames: AsyncIterable<AudioFrame>, signal: AbortSignal): Promise<SfuTrackRef>;
  disconnect(reason: string): Promise<void>;
}

export interface CloudflareRealtimeSignaling {
  createSession(signal: AbortSignal): Promise<{ sessionId: string }>;
  subscribeTrack(track: SfuTrackRef, signal: AbortSignal): AsyncIterable<AudioFrame>;
  publishTrack(
    trackName: string,
    frames: AsyncIterable<AudioFrame>,
    signal: AbortSignal,
  ): Promise<void>;
  closeSession(sessionId: string, reason: string): Promise<void>;
}

/**
 * Cloudflare owns SFU signaling/media transport; this class only binds it to the
 * orchestrator contract. A WebRTC implementation is injected because Node has no
 * built-in RTCPeerConnection and the worker must not depend on browser globals.
 */
export class CloudflareRealtimeSfuAdapter implements SfuMediaAdapter {
  readonly id = "cloudflare-realtime";
  #sessionId?: string;

  constructor(private readonly signaling: CloudflareRealtimeSignaling) {}

  async connect(input: {
    callId: string;
    participantId: string;
    workerToken: string;
    signal: AbortSignal;
  }): Promise<void> {
    if (!input.workerToken) throw new Error("Ephemeral worker token is required");
    this.#sessionId = (await this.signaling.createSession(input.signal)).sessionId;
  }

  subscribe(track: SfuTrackRef, signal: AbortSignal): AsyncIterable<AudioFrame> {
    if (!this.#sessionId) throw new Error("SFU adapter is not connected");
    return this.signaling.subscribeTrack(track, signal);
  }

  async publish(
    frames: AsyncIterable<AudioFrame>,
    signal: AbortSignal,
  ): Promise<SfuTrackRef> {
    if (!this.#sessionId) throw new Error("SFU adapter is not connected");
    const track = {
      sessionId: this.#sessionId,
      trackName: `voice-worker-${crypto.randomUUID()}`,
    };
    await this.signaling.publishTrack(track.trackName, frames, signal);
    return track;
  }

  async disconnect(reason: string): Promise<void> {
    if (!this.#sessionId) return;
    const sessionId = this.#sessionId;
    this.#sessionId = undefined;
    await this.signaling.closeSession(sessionId, reason);
  }
}

export interface BrainTurnRequest {
  callId: string;
  workspaceId: string;
  transcript: TranscriptFrame[];
  workerToken: string;
  signal: AbortSignal;
}

export interface BrainTurnResponse {
  turnId: string;
  text: string;
  voice?: string;
}

export interface BrainApiClient {
  createTurn(request: BrainTurnRequest): Promise<BrainTurnResponse>;
  cancelTurn(turnId: string, workerToken: string, signal?: AbortSignal): Promise<void>;
}

export class HttpBrainApiClient implements BrainApiClient {
  readonly #tokens = new Map<string, string>();

  constructor(private readonly baseUrl: URL) {}

  async createTurn(request: BrainTurnRequest): Promise<BrainTurnResponse> {
    const workerToken = await this.#currentToken(request.workerToken, request.signal);
    const response = await fetch(new URL("/api/brain/voice-worker/turns", this.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        callId: request.callId,
        workspaceId: request.workspaceId,
        transcript: request.transcript.map(({ text, isFinal, confidence, language }) => ({
          text,
          isFinal,
          confidence,
          language,
        })),
      }),
      signal: request.signal,
    });
    if (!response.ok) throw new Error(`Brain turn failed with ${response.status}`);
    return (await response.json()) as BrainTurnResponse;
  }

  async cancelTurn(turnId: string, workerToken: string, signal?: AbortSignal): Promise<void> {
    const currentToken = await this.#currentToken(
      workerToken,
      signal ?? AbortSignal.timeout(5_000),
    );
    const response = await fetch(
      new URL(`/api/brain/voice-worker/turns/${encodeURIComponent(turnId)}/cancel`, this.baseUrl),
      {
        method: "POST",
        headers: { authorization: `Bearer ${currentToken}` },
        signal,
      },
    );
    if (!response.ok && response.status !== 409) {
      throw new Error(`Brain turn cancellation failed with ${response.status}`);
    }
  }

  async #currentToken(token: string, signal: AbortSignal): Promise<string> {
    const claims = unsafeTokenClaims(token);
    const cached = this.#tokens.get(claims.callId) ?? token;
    const cachedClaims = unsafeTokenClaims(cached);
    if (cachedClaims.exp - Math.floor(Date.now() / 1000) > 60) return cached;
    const response = await fetch(
      new URL("/api/brain/voice-worker/tokens/refresh", this.baseUrl),
      {
        method: "POST",
        headers: { authorization: `Bearer ${cached}` },
        signal,
      },
    );
    if (!response.ok) throw new Error(`Worker token refresh failed with ${response.status}`);
    const body = (await response.json()) as { token?: string };
    if (!body.token) throw new Error("Worker token refresh returned no token");
    const refreshedClaims = unsafeTokenClaims(body.token);
    if (
      refreshedClaims.callId !== claims.callId ||
      refreshedClaims.workspaceId !== claims.workspaceId ||
      refreshedClaims.sub !== claims.sub
    ) {
      throw new Error("Worker token refresh identity mismatch");
    }
    this.#tokens.set(claims.callId, body.token);
    return body.token;
  }
}

function unsafeTokenClaims(token: string): {
  callId: string;
  workspaceId: string;
  sub: string;
  exp: number;
} {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed worker token");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    callId?: unknown;
    workspaceId?: unknown;
    sub?: unknown;
    exp?: unknown;
  };
  if (
    typeof claims.callId !== "string" ||
    typeof claims.workspaceId !== "string" ||
    typeof claims.sub !== "string" ||
    typeof claims.exp !== "number"
  ) {
    throw new Error("Malformed worker token claims");
  }
  return {
    callId: claims.callId,
    workspaceId: claims.workspaceId,
    sub: claims.sub,
    exp: claims.exp,
  };
}
