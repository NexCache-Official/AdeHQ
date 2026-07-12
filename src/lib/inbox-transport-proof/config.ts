/**
 * Slice 0 transport-proof config. REMOVABLE.
 * Never logs secret values.
 */

import { resolve } from "node:path";

export const INBOX_PROOF_DOMAIN =
  process.env.INBOX_PROOF_DOMAIN?.trim() || "inbox.adehq.com";

export const INBOX_PROOF_FROM =
  process.env.INBOX_PROOF_FROM?.trim() ||
  `AdeHQ Inbox Proof <proof@${INBOX_PROOF_DOMAIN}>`;

export function isInboxProofEnabled(): boolean {
  return process.env.INBOX_PROOF_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Inbox/workspace Resend account key.
 * Prefer RESEND_INBOX_API_KEY when using a separate Resend account for
 * inbox.adehq.com; fall back to RESEND_API_KEY only for single-account setups.
 * Transactional product mail keeps using RESEND_API_KEY in src/lib/email/send.ts.
 */
export function getResendApiKey(): string | null {
  const inboxKey = process.env.RESEND_INBOX_API_KEY?.trim();
  if (inboxKey) return inboxKey;
  return process.env.RESEND_API_KEY?.trim() || null;
}

export function getInboxWebhookSecret(): string | null {
  const secret =
    process.env.RESEND_INBOX_WEBHOOK_SECRET?.trim() ||
    process.env.RESEND_WEBHOOK_SECRET?.trim();
  return secret || null;
}

/** Local JSONL / artifact store — never commit. */
export function getProofStoreDir(): string {
  return (
    process.env.INBOX_PROOF_STORE_DIR?.trim() ||
    resolve(process.cwd(), ".tmp/inbox-transport-proof")
  );
}

export function redactSecretPresence(name: string, present: boolean): string {
  return `${name}=${present ? "<set>" : "<missing>"}`;
}
