/**
 * Provider-agnostic workspace email transport.
 */

export type SendEmailInput = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  tags?: Array<{ name: string; value: string }>;
  idempotencyKey?: string;
};

export type SendResult = {
  providerMessageId: string;
};

export type InboundWebhookMeta = {
  eventType: string;
  providerEmailId: string | null;
  svixId: string | null;
  rawPayload: unknown;
};

export type InboundEmailBody = {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  receivedFor: string[];
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  messageId: string;
  attachments: Array<{
    id: string;
    filename: string | null;
    contentType: string;
    size: number;
    contentId: string | null;
    contentDisposition: string | null;
  }>;
  rawDownloadUrl?: string | null;
};

export type InboundAttachmentDownload = {
  filename: string | null;
  contentType: string | null;
  size: number | null;
  downloadUrl: string;
  expiresAt?: string | null;
};

export interface WorkspaceEmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendResult>;
  verifyInboundWebhook(
    rawBody: string,
    headers: { id: string | null; timestamp: string | null; signature: string | null },
  ): { ok: true; payload: unknown } | { ok: false; reason: string };
  parseInboundWebhook(payload: unknown): InboundWebhookMeta;
  fetchReceivedEmail(providerEmailId: string): Promise<InboundEmailBody>;
  listReceivedAttachments(providerEmailId: string): Promise<InboundAttachmentDownload[]>;
}

export function extractEventMeta(payload: unknown): {
  eventType: string | null;
  providerEmailId: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { eventType: null, providerEmailId: null };
  }
  const p = payload as Record<string, unknown>;
  const eventType = typeof p.type === "string" ? p.type : null;
  const data = p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : null;
  const providerEmailId =
    data && typeof data.email_id === "string"
      ? data.email_id
      : data && typeof data.id === "string"
        ? data.id
        : null;
  return { eventType, providerEmailId };
}
