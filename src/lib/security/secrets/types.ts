export type SecretRef = string;

export type StoredSecret = {
  secretRef: SecretRef;
  last4: string;
  fingerprint: string;
  keyVersion: number;
};

export type EncryptedSecretEnvelope = {
  version: "v1";
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
};
