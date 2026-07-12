/**
 * Workspace inbox env (conversational mail — separate from transactional RESEND_API_KEY).
 */

export function getInboxResendApiKey(): string | null {
  return (
    process.env.RESEND_INBOX_API_KEY?.trim() ||
    process.env.RESEND_API_KEY?.trim() ||
    null
  );
}

export function getInboxWebhookSecret(): string | null {
  return (
    process.env.RESEND_INBOX_WEBHOOK_SECRET?.trim() ||
    process.env.RESEND_WEBHOOK_SECRET?.trim() ||
    null
  );
}

export function getInboxDomain(): string {
  return process.env.INBOX_PROOF_DOMAIN?.trim() || process.env.INBOX_DOMAIN?.trim() || "inbox.adehq.com";
}
