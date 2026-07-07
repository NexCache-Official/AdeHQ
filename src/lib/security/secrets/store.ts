import { decryptSecret, encryptSecret, getCurrentSecretKeyVersion } from "./encrypt";
import { secretLast4, sha256Fingerprint } from "./fingerprint";
import type { SecretRef, StoredSecret } from "./types";

export function putSecret(plaintext: string): StoredSecret {
  const trimmed = plaintext.trim();
  if (!trimmed) throw new Error("Secret value is required.");
  const keyVersion = getCurrentSecretKeyVersion();
  return {
    secretRef: encryptSecret(trimmed, keyVersion),
    last4: secretLast4(trimmed),
    fingerprint: sha256Fingerprint(trimmed),
    keyVersion,
  };
}

export function getSecret(secretRef: SecretRef): string {
  return decryptSecret(secretRef);
}

export { sha256Fingerprint, secretLast4 };
