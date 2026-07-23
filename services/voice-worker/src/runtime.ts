import { verifyWorkerToken, type WorkerTokenClaims } from "./auth.js";
import type { SfuTrackRef } from "./boundaries.js";
import { VoiceOrchestrator, type VoiceSessionInput } from "./orchestrator.js";

export interface VoiceOrchestratorFactory {
  readonly readiness: {
    inference: boolean;
    brain: boolean;
    cloudflareApi: boolean;
    mediaTransport: boolean;
  };
  create(): VoiceOrchestrator;
}

export interface SessionStartBody {
  inputTrack: SfuTrackRef;
}

type ActiveSession = {
  claims: WorkerTokenClaims;
  orchestrator: VoiceOrchestrator;
  run: Promise<void>;
  state: "starting" | "active" | "stopping" | "failed";
  error?: string;
};

export class VoiceSessionManager {
  readonly #sessions = new Map<string, ActiveSession>();

  constructor(private readonly factory: VoiceOrchestratorFactory) {}

  get size(): number {
    return this.#sessions.size;
  }

  status(callId: string): Pick<ActiveSession, "state" | "error"> | undefined {
    const session = this.#sessions.get(callId);
    return session ? { state: session.state, error: session.error } : undefined;
  }

  async start(
    claims: WorkerTokenClaims,
    workerToken: string,
    body: SessionStartBody,
  ): Promise<void> {
    if (this.#sessions.has(claims.callId)) throw new RuntimeError("Session already exists", 409);
    if (!body.inputTrack?.sessionId || !body.inputTrack.trackName) {
      throw new RuntimeError("inputTrack is required", 400);
    }
    const orchestrator = this.factory.create();
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const input: VoiceSessionInput = {
      callId: claims.callId,
      workspaceId: claims.workspaceId,
      participantId: claims.sub,
      workerToken,
      inputTrack: body.inputTrack,
      onReady: readyResolve,
    };
    const active: ActiveSession = {
      claims,
      orchestrator,
      state: "starting",
      run: Promise.resolve(),
    };
    active.run = orchestrator.run(input).then(
      () => {
        this.#sessions.delete(claims.callId);
      },
      (error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (active.state === "starting") readyReject(normalized);
        active.state = "failed";
        active.error = normalized.message;
      },
    );
    this.#sessions.set(claims.callId, active);
    try {
      await ready;
      active.state = "active";
    } catch (error) {
      this.#sessions.delete(claims.callId);
      await orchestrator.stop(workerToken).catch(() => undefined);
      throw error;
    }
  }

  async interrupt(claims: WorkerTokenClaims, token: string, reason: string): Promise<void> {
    const session = this.#authorizedSession(claims);
    await session.orchestrator.interrupt(reason, token);
  }

  async stop(claims: WorkerTokenClaims, token: string): Promise<void> {
    const session = this.#authorizedSession(claims);
    session.state = "stopping";
    await session.orchestrator.stop(token);
    await session.run;
    this.#sessions.delete(claims.callId);
  }

  #authorizedSession(claims: WorkerTokenClaims): ActiveSession {
    const session = this.#sessions.get(claims.callId);
    if (!session) throw new RuntimeError("Session not found", 404);
    if (
      session.claims.workspaceId !== claims.workspaceId ||
      session.claims.sub !== claims.sub
    ) {
      throw new RuntimeError("Session not found", 404);
    }
    return session;
  }
}

export type RuntimeResponse = {
  status: number;
  body: Record<string, unknown>;
};

export class VoiceWorkerRuntime {
  readonly sessions: VoiceSessionManager;

  constructor(
    readonly factory: VoiceOrchestratorFactory,
    private readonly tokenSecret: string,
  ) {
    this.sessions = new VoiceSessionManager(factory);
  }

  readiness(): {
    ready: boolean;
    capabilities: VoiceOrchestratorFactory["readiness"];
  } {
    const capabilities = this.factory.readiness;
    return {
      ready:
        this.tokenSecret.length >= 32 &&
        Object.values(capabilities).every(Boolean),
      capabilities,
    };
  }

  async handle(input: {
    method: string;
    path: string;
    authorization?: string;
    body?: unknown;
  }): Promise<RuntimeResponse> {
    try {
      const match = input.path.match(/^\/v1\/sessions(?:\/([^/]+)(?:\/(interrupt))?)?$/);
      if (!match) throw new RuntimeError("Not found", 404);
      const token = bearerToken(input.authorization);
      let claims: WorkerTokenClaims;
      try {
        claims = verifyWorkerToken(token, this.tokenSecret, [
          "sfu:connect",
          "sfu:publish",
          "sfu:subscribe",
          "brain:turn",
        ]);
      } catch {
        throw new RuntimeError("Invalid or expired worker token", 401);
      }
      const callId = match[1] ? decodeURIComponent(match[1]) : undefined;
      if (callId && callId !== claims.callId) throw new RuntimeError("Session not found", 404);

      if (input.method === "POST" && !callId) {
        if (!this.readiness().ready) throw new RuntimeError("Worker is not ready", 503);
        await this.sessions.start(claims, token, input.body as SessionStartBody);
        return { status: 201, body: { callId: claims.callId, state: "active" } };
      }
      if (input.method === "GET" && callId && !match[2]) {
        const status = this.sessions.status(callId);
        if (!status) throw new RuntimeError("Session not found", 404);
        return { status: 200, body: { callId, ...status } };
      }
      if (input.method === "POST" && callId && match[2] === "interrupt") {
        const reason = String((input.body as { reason?: unknown } | undefined)?.reason ?? "interrupt");
        await this.sessions.interrupt(claims, token, reason.slice(0, 200));
        return { status: 202, body: { callId, state: "interrupted" } };
      }
      if (input.method === "DELETE" && callId && !match[2]) {
        await this.sessions.stop(claims, token);
        return { status: 200, body: { callId, state: "stopped" } };
      }
      throw new RuntimeError("Method not allowed", 405);
    } catch (error) {
      const status =
        error instanceof RuntimeError
          ? error.status
          : /token|bearer|signature|scope|expired|audience/i.test(
                error instanceof Error ? error.message : "",
              )
            ? 401
            : 500;
      return {
        status,
        body: {
          error:
            status === 500
              ? "Internal worker error"
              : error instanceof Error
                ? error.message
                : "Request failed",
        },
      };
    }
  }
}

class RuntimeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function bearerToken(authorization: string | undefined): string {
  if (!authorization?.startsWith("Bearer ")) throw new RuntimeError("Bearer token required", 401);
  const token = authorization.slice(7).trim();
  if (!token) throw new RuntimeError("Bearer token required", 401);
  return token;
}
