/**
 * Full send-envelope hash for version-locked approvals.
 * Server always recomputes — never trust client approved flags.
 */

import { createHash } from "crypto";

export type SendEnvelope = {
  mailboxId: string;
  fromAddress: string;
  replyTo?: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string;
  htmlBody: string;
  attachmentIds: string[];
  attachmentContentHashes: string[];
  threadId: string;
  draftVersionId: string;
};

function normList(values: string[]): string[] {
  return [...values].map((v) => v.trim().toLowerCase()).filter(Boolean).sort();
}

export function computeApprovalHash(envelope: SendEnvelope): string {
  const payload = JSON.stringify({
    mailboxId: envelope.mailboxId,
    from: envelope.fromAddress.trim().toLowerCase(),
    replyTo: (envelope.replyTo ?? "").trim().toLowerCase(),
    to: normList(envelope.to),
    cc: normList(envelope.cc),
    bcc: normList(envelope.bcc),
    subject: envelope.subject,
    text: envelope.textBody,
    html: envelope.htmlBody,
    attachmentIds: [...envelope.attachmentIds].sort(),
    attachmentHashes: [...envelope.attachmentContentHashes].sort(),
    threadId: envelope.threadId,
    draftVersionId: envelope.draftVersionId,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/** Legacy field hashes kept for existing email_approvals columns. */
export function computeFieldHashes(envelope: SendEnvelope): {
  recipientHash: string;
  subjectHash: string;
  bodyHash: string;
  attachmentHash: string;
} {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  return {
    recipientHash: sha(JSON.stringify({ to: normList(envelope.to), cc: normList(envelope.cc), bcc: normList(envelope.bcc) })),
    subjectHash: sha(envelope.subject),
    bodyHash: sha(`${envelope.textBody}\n${envelope.htmlBody}`),
    attachmentHash: sha(JSON.stringify({
      ids: [...envelope.attachmentIds].sort(),
      hashes: [...envelope.attachmentContentHashes].sort(),
    })),
  };
}

export function approvalExpiryIso(ttlHours: number, from = new Date()): string {
  return new Date(from.getTime() + ttlHours * 3600_000).toISOString();
}
