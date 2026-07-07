import { createHash } from "node:crypto";

export function sha256Fingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext.trim(), "utf8").digest("hex");
}

export function secretLast4(plaintext: string): string {
  return plaintext.trim().slice(-4);
}
