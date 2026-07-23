import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type VoiceWorkerScope =
  | "sfu:connect"
  | "sfu:publish"
  | "sfu:subscribe"
  | "brain:turn";

export type VoiceWorkerTokenClaims = {
  iss: "adehq-app";
  aud: "adehq-voice-worker";
  sub: string;
  workspaceId: string;
  callId: string;
  scopes: VoiceWorkerScope[];
  iat: number;
  exp: number;
  nonce: string;
};

function secret(): string {
  const value = process.env.ADEHQ_WORKER_TOKEN_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("ADEHQ_WORKER_TOKEN_SECRET must be at least 32 bytes.");
  }
  return value;
}

function signature(value: string): Buffer {
  return createHmac("sha256", secret()).update(value).digest();
}

export function createVoiceWorkerToken(input: {
  userId: string;
  workspaceId: string;
  callId: string;
  scopes?: VoiceWorkerScope[];
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: VoiceWorkerTokenClaims = {
    iss: "adehq-app",
    aud: "adehq-voice-worker",
    sub: input.userId,
    workspaceId: input.workspaceId,
    callId: input.callId,
    scopes: input.scopes ?? ["sfu:connect", "sfu:publish", "sfu:subscribe", "brain:turn"],
    iat: now,
    exp: now + Math.min(300, Math.max(30, input.ttlSeconds ?? 300)),
    nonce: randomUUID(),
  };
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT", kid: "voice-worker-v1" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signature(unsigned).toString("base64url")}`;
}

export function verifyVoiceWorkerToken(
  token: string,
  requiredScopes: VoiceWorkerScope[] = [],
): VoiceWorkerTokenClaims {
  const [headerPart, payloadPart, suppliedPart, extra] = token.split(".");
  if (!headerPart || !payloadPart || !suppliedPart || extra) {
    throw new Error("Malformed voice worker token.");
  }
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as {
    alg?: string;
    typ?: string;
  };
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error("Unsupported voice worker token.");
  }
  const expected = signature(`${headerPart}.${payloadPart}`);
  const supplied = Buffer.from(suppliedPart, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("Invalid voice worker token signature.");
  }
  const claims = JSON.parse(
    Buffer.from(payloadPart, "base64url").toString("utf8"),
  ) as VoiceWorkerTokenClaims;
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== "adehq-app" ||
    claims.aud !== "adehq-voice-worker" ||
    !claims.sub ||
    !claims.workspaceId ||
    !claims.callId ||
    !claims.nonce ||
    !Array.isArray(claims.scopes) ||
    claims.iat > now + 30 ||
    claims.exp <= now ||
    claims.exp - claims.iat > 300
  ) {
    throw new Error("Invalid or expired voice worker token.");
  }
  if (!requiredScopes.every((scope) => claims.scopes.includes(scope))) {
    throw new Error("Voice worker token has insufficient scope.");
  }
  return claims;
}

export function bearerVoiceWorkerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Voice worker bearer token required.");
  }
  return authorization.slice(7).trim();
}
