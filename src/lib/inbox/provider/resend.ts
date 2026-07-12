/**
 * Resend implementation of WorkspaceEmailProvider (inbox account).
 */

import { Resend } from "resend";
import { getInboxResendApiKey, getInboxWebhookSecret } from "@/lib/inbox/config";
import type {
  InboundAttachmentDownload,
  InboundEmailBody,
  InboundWebhookMeta,
  SendEmailInput,
  SendResult,
  WorkspaceEmailProvider,
} from "./types";
import { extractEventMeta } from "./types";

function requireClient(): Resend {
  const key = getInboxResendApiKey();
  if (!key) throw new Error("RESEND_INBOX_API_KEY (or RESEND_API_KEY) is not configured");
  return new Resend(key);
}

export class ResendWorkspaceEmailProvider implements WorkspaceEmailProvider {
  async sendEmail(input: SendEmailInput): Promise<SendResult> {
    const resend = requireClient();
    const content =
      input.html != null && input.html.length > 0
        ? { html: input.html, ...(input.text ? { text: input.text } : {}) }
        : { text: input.text ?? "" };

    const { data, error } = await resend.emails.send(
      {
        from: input.from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        ...content,
        replyTo: input.replyTo,
        headers: input.headers,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
        tags: input.tags,
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    );
    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error("Resend send returned no id");
    return { providerMessageId: data.id };
  }

  verifyInboundWebhook(
    rawBody: string,
    headers: { id: string | null; timestamp: string | null; signature: string | null },
  ): { ok: true; payload: unknown } | { ok: false; reason: string } {
    const secret = getInboxWebhookSecret();
    if (!secret) {
      return { ok: false, reason: "RESEND_INBOX_WEBHOOK_SECRET is not set" };
    }
    if (!headers.id || !headers.timestamp || !headers.signature) {
      return { ok: false, reason: "Missing svix-id / svix-timestamp / svix-signature headers" };
    }
    try {
      const resend = requireClient();
      const payload = resend.webhooks.verify({
        payload: rawBody,
        headers: {
          id: headers.id,
          timestamp: headers.timestamp,
          signature: headers.signature,
        },
        webhookSecret: secret,
      });
      return { ok: true, payload };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "Signature verification failed",
      };
    }
  }

  parseInboundWebhook(payload: unknown): InboundWebhookMeta {
    const { eventType, providerEmailId } = extractEventMeta(payload);
    const svixId =
      payload && typeof payload === "object" && "svix_id" in (payload as object)
        ? String((payload as Record<string, unknown>).svix_id)
        : null;
    return {
      eventType: eventType ?? "unknown",
      providerEmailId,
      svixId,
      rawPayload: payload,
    };
  }

  async fetchReceivedEmail(providerEmailId: string): Promise<InboundEmailBody> {
    const resend = requireClient();
    const { data, error } = await resend.emails.receiving.get(providerEmailId);
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Received email not found");
    return {
      id: data.id,
      from: data.from,
      to: data.to ?? [],
      cc: data.cc ?? [],
      bcc: data.bcc ?? [],
      replyTo: data.reply_to ?? [],
      receivedFor: data.received_for ?? [],
      subject: data.subject ?? "",
      text: data.text,
      html: data.html,
      headers: data.headers ?? {},
      messageId: data.message_id,
      attachments: (data.attachments ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type,
        size: a.size,
        contentId: a.content_id,
        contentDisposition: a.content_disposition,
      })),
      rawDownloadUrl: data.raw?.download_url ?? null,
    };
  }

  async listReceivedAttachments(providerEmailId: string): Promise<InboundAttachmentDownload[]> {
    const resend = requireClient();
    const { data, error } = await resend.emails.receiving.attachments.list({
      emailId: providerEmailId,
    });
    if (error) throw new Error(error.message);
    return (data?.data ?? []).map((a) => ({
      filename: a.filename ?? null,
      contentType: a.content_type ?? null,
      size: a.size ?? null,
      downloadUrl: a.download_url,
      expiresAt: a.expires_at ?? null,
    }));
  }
}

let singleton: ResendWorkspaceEmailProvider | null = null;

export function getWorkspaceEmailProvider(): WorkspaceEmailProvider {
  if (!singleton) singleton = new ResendWorkspaceEmailProvider();
  return singleton;
}
