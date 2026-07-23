import { createHmac, timingSafeEqual } from "node:crypto";

export type WorkerScope =
  | "sfu:connect"
  | "sfu:publish"
  | "sfu:subscribe"
  | "brain:turn";

export interface WorkerTokenClaims {
  iss: "adehq-app";
  aud: "adehq-voice-worker";
  sub: string;
  workspaceId: string;
  callId: string;
  scopes: WorkerScope[];
  iat: number;
  exp: number;
  nonce: string;
}

const encode = (value: string | Buffer): string => Buffer.from(value).toString("base64url");
const decodeJson = <T>(value: string): T =>
  JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;

function signature(secret: string, value: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

export function signWorkerToken(claims: WorkerTokenClaims, secret: string): string {
  if (secret.length < 32) throw new Error("Worker token secret must be at least 32 bytes");
  if (claims.exp <= claims.iat || claims.exp - claims.iat > 300) {
    throw new Error("Worker token lifetime must be positive and no longer than five minutes");
  }
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "voice-worker-v1" }));
  const payload = encode(JSON.stringify(claims));
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${encode(signature(secret, unsigned))}`;
}

export function verifyWorkerToken(
  token: string,
  secret: string,
  requiredScopes: WorkerScope[] = [],
  nowSeconds = Math.floor(Date.now() / 1000),
): WorkerTokenClaims {
  const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra) throw new Error("Malformed worker token");

  const header = decodeJson<{ alg?: string; typ?: string }>(headerPart);
  if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("Unsupported worker token");
  const expected = signature(secret, `${headerPart}.${payloadPart}`);
  const actual = Buffer.from(signaturePart, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Invalid worker token signature");
  }

  const claims = decodeJson<WorkerTokenClaims>(payloadPart);
  if (claims.iss !== "adehq-app" || claims.aud !== "adehq-voice-worker") {
    throw new Error("Invalid worker token audience");
  }
  if (!claims.sub || !claims.workspaceId || !claims.callId || !claims.nonce) {
    throw new Error("Incomplete worker token");
  }
  if (!Array.isArray(claims.scopes) || !claims.scopes.every(isWorkerScope)) {
    throw new Error("Invalid worker token scopes");
  }
  if (claims.iat > nowSeconds + 30 || claims.exp <= nowSeconds || claims.exp - claims.iat > 300) {
    throw new Error("Expired or overlong worker token");
  }
  if (!requiredScopes.every((scope) => claims.scopes.includes(scope))) {
    throw new Error("Worker token has insufficient scope");
  }
  return claims;
}

function isWorkerScope(value: unknown): value is WorkerScope {
  return (
    value === "sfu:connect" ||
    value === "sfu:publish" ||
    value === "sfu:subscribe" ||
    value === "brain:turn"
  );
}
