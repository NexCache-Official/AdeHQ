import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { getSiteUrl } from "@/lib/site-url";
import { EMAIL_FROM, EMAIL_REPLY_TO } from "@/emails/theme";
import {
  EMAIL_REGISTRY,
  type TemplateDefinition,
  type TemplateKey,
  type TemplateProps,
} from "@/emails/registry";
import { renderEmail } from "./render";
import { recordEmailSend, type EmailSendStatus } from "./log";
import {
  buildUnsubscribeUrl,
  checkEmailAllowed,
  isAlwaysOn,
} from "./preferences";

export type SendEmailArgs<K extends TemplateKey> = {
  template: K;
  to: string;
  props: TemplateProps<K>;
  workspaceId?: string | null;
  userId?: string | null;
  /** Reuse a Supabase secret-key client (e.g. inside a route that already made one). */
  client?: SupabaseClient;
};

export type SendEmailResult = {
  status: EmailSendStatus;
  providerMessageId?: string | null;
  error?: string;
  /** True when Resend accepted the message (status "sent" or "test_redirected"). */
  delivered: boolean;
};

let resendClient: Resend | null = null;
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  if (!resendClient) resendClient = new Resend(key);
  return resendClient;
}

function isTestMode(): boolean {
  return process.env.EMAIL_TEST_MODE?.trim().toLowerCase() === "true";
}

/**
 * The single outbound email pipeline. Every email — auth or product — flows
 * through here:
 *   preference gate (skip gated opt-outs) → test-mode redirect → render →
 *   Resend send → email_send_log write.
 * Never throws for provider failures; inspect `result.status`/`delivered`.
 */
export async function sendEmail<K extends TemplateKey>({
  template,
  to,
  props,
  workspaceId,
  userId,
  client,
}: SendEmailArgs<K>): Promise<SendEmailResult> {
  const def = EMAIL_REGISTRY[template] as TemplateDefinition<TemplateProps<K>>;
  const category = def.category;
  const recipient = to.trim().toLowerCase();
  const siteUrl = getSiteUrl();

  // 1) Preference gate (always-on categories bypass).
  let unsubscribeUrl: string | undefined;
  if (!isAlwaysOn(category)) {
    const gate = await checkEmailAllowed(recipient, category, { userId, client });
    if (!gate.allowed) {
      await recordEmailSend(
        {
          template,
          category,
          recipient,
          subject: def.subject(props),
          status: "skipped_unsubscribed",
          workspaceId,
          userId,
        },
        client,
      );
      return { status: "skipped_unsubscribed", delivered: false };
    }
    if (gate.unsubscribeToken) {
      unsubscribeUrl = buildUnsubscribeUrl(siteUrl, gate.unsubscribeToken, category);
    }
  }

  // 2) Build subject + element (inject unsubscribeUrl for gated templates).
  const intendedSubject = def.subject(props);
  const componentProps = unsubscribeUrl
    ? { ...(props as object), unsubscribeUrl }
    : (props as object);
  const element = createElement(def.Component as (p: object) => JSX.Element, componentProps);

  // 3) Test-mode redirect.
  const testMode = isTestMode();
  const testInbox = process.env.EMAIL_TEST_INBOX?.trim();
  const deliverTo = testMode && testInbox ? testInbox : recipient;
  const subject =
    testMode && testInbox ? `[test -> ${recipient}] ${intendedSubject}` : intendedSubject;
  const finalStatus: EmailSendStatus =
    testMode && testInbox ? "test_redirected" : "sent";

  // 4) Render.
  let html: string;
  let text: string;
  try {
    ({ html, text } = await renderEmail(element));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordEmailSend(
      { template, category, recipient, subject: intendedSubject, status: "failed", error: `render: ${message}`, workspaceId, userId },
      client,
    );
    return { status: "failed", error: message, delivered: false };
  }

  // 5) Send via Resend.
  const resend = getResend();
  if (!resend) {
    // No API key — treat as failure but log clearly (dev without Resend).
    const error = "RESEND_API_KEY is not configured";
    await recordEmailSend(
      { template, category, recipient, subject, status: "failed", error, workspaceId, userId },
      client,
    );
    console.warn(`[AdeHQ email] ${error}; skipped ${template} -> ${recipient}`);
    return { status: "failed", error, delivered: false };
  }

  const headers: Record<string, string> = {};
  if (unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: deliverTo,
      subject,
      html,
      text,
      replyTo: EMAIL_REPLY_TO,
      headers: Object.keys(headers).length ? headers : undefined,
    });

    if (error) throw new Error(error.message);

    await recordEmailSend(
      {
        template,
        category,
        recipient,
        subject,
        status: finalStatus,
        providerMessageId: data?.id ?? null,
        workspaceId,
        userId,
        metadata: testMode && testInbox ? { redirectedFrom: recipient, deliveredTo: deliverTo } : {},
      },
      client,
    );
    return { status: finalStatus, providerMessageId: data?.id ?? null, delivered: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordEmailSend(
      { template, category, recipient, subject, status: "failed", error: message, workspaceId, userId },
      client,
    );
    console.error(`[AdeHQ email] send failed for ${template} -> ${recipient}:`, message);
    return { status: "failed", error: message, delivered: false };
  }
}
