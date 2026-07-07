import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENVELOPE_PREFIX = "enc:v1";
const ALGORITHM = "aes-256-gcm";

function assertNodeRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Secret encryption is server-only.");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    throw new Error("Secret encryption requires the Node.js runtime.");
  }
}

function normalizeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Secret encryption key is empty.");

  const base64 = Buffer.from(trimmed, "base64");
  if (base64.length === 32) return base64;

  const hex = Buffer.from(trimmed, "hex");
  if (hex.length === 32) return hex;

  const utf8 = Buffer.from(trimmed, "utf8");
  if (utf8.length === 32) return utf8;

  throw new Error("ADEHQ_SECRET_ENCRYPTION_KEY must decode to 32 bytes.");
}

export function getCurrentSecretKeyVersion(): number {
  const version = Number(process.env.ADEHQ_SECRET_ENCRYPTION_KEY_VERSION ?? 1);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

function keyForVersion(version: number): Buffer {
  assertNodeRuntime();
  const envName =
    version === getCurrentSecretKeyVersion()
      ? "ADEHQ_SECRET_ENCRYPTION_KEY"
      : `ADEHQ_SECRET_ENCRYPTION_KEY_V${version}`;
  const raw = process.env[envName] ?? (version === 1 ? process.env.ADEHQ_SECRET_ENCRYPTION_KEY : undefined);
  if (!raw?.trim()) {
    throw new Error(`${envName} is not configured.`);
  }
  return normalizeKeyMaterial(raw);
}

export function encryptSecret(plaintext: string, keyVersion = getCurrentSecretKeyVersion()): string {
  assertNodeRuntime();
  const key = keyForVersion(keyVersion);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_PREFIX,
    String(keyVersion),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(envelope: string): string {
  assertNodeRuntime();
  const [prefixA, prefixB, versionRaw, ivRaw, tagRaw, ciphertextRaw] = envelope.split(":");
  if (`${prefixA}:${prefixB}` !== ENVELOPE_PREFIX || !versionRaw || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Unsupported secret envelope.");
  }
  const keyVersion = Number(versionRaw);
  if (!Number.isInteger(keyVersion) || keyVersion <= 0) {
    throw new Error("Invalid secret key version.");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    keyForVersion(keyVersion),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
