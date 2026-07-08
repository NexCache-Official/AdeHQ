import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";
import { SUPABASE_PROJECT_URL } from "@/lib/supabase/config";
import { getSiteUrl } from "@/lib/site-url";
import { sendEmail } from "@/lib/email/send";
import type { TemplateKey } from "@/emails/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase "Send Email" Auth Hook.
 *
 * Supabase POSTs a signed webhook for every auth email (signup, magiclink,
 * recovery, email_change, reauthentication, invite). We verify the signature,
 * route by `email_action_type` to a branded template, build the verify URL that
 * lands on /auth/callback, render + send via Resend, and return the
 * Supabase-expected shape on failure so the auth flow surfaces a clean error.
 */

type EmailData = {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url?: string;
  token_new?: string;
  token_hash_new?: string;
  new_email?: string;
};

type HookPayload = {
  user: { email: string };
  email_data: EmailData;
};

/** Supabase verify endpoint types keyed by email_action_type. */
const VERIFY_TYPE: Record<string, string> = {
  signup: "signup",
  magiclink: "magiclink",
  recovery: "recovery",
  email_change: "email_change",
  invite: "invite",
};

function buildVerifyUrl(tokenHash: string, actionType: string, redirectTo: string): string {
  const type = VERIFY_TYPE[actionType] ?? actionType;
  const params = new URLSearchParams({
    token: tokenHash,
    type,
    redirect_to: redirectTo || `${getSiteUrl()}/auth/callback`,
  });
  // Keep email links on our branded domain; we proxy to Supabase verify in
  // `src/app/auth/verify/route.ts`.
  return `${getSiteUrl()}/auth/verify?${params.toString()}`;
}

/** Supabase expects this shape so it surfaces a clean auth error to the user. */
function hookError(message: string, httpCode = 500) {
  return NextResponse.json({ error: { http_code: httpCode, message } }, { status: httpCode });
}

export async function POST(request: NextRequest) {
  const rawSecret = process.env.SEND_EMAIL_HOOK_SECRET?.trim();
  if (!rawSecret) {
    console.error("[AdeHQ auth hook] SEND_EMAIL_HOOK_SECRET is not configured");
    return hookError("Email hook is not configured", 500);
  }

  // Supabase provides secrets in the form `v1,whsec_...`.
  // `standardwebhooks` expects the base64 part behind `whsec_...` and will
  // only auto-strip a `whsec_` prefix, not the leading `v1,`.
  const secret = rawSecret.startsWith("v1,") ? rawSecret.slice("v1,".length) : rawSecret;

  const payload = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  // 1) Verify the signed webhook.
  let event: HookPayload;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(payload, headers) as HookPayload;
  } catch (err) {
    console.warn("[AdeHQ auth hook] signature verification failed:", err);
    return NextResponse.json(
      { error: { http_code: 401, message: "Invalid signature" } },
      { status: 401 },
    );
  }

  const to = event.user?.email;
  const data = event.email_data;
  if (!to || !data?.email_action_type) {
    return hookError("Malformed hook payload", 400);
  }

  const actionType = data.email_action_type;

  // 2) Route by action type -> template + props.
  let template: TemplateKey;
  let props: Record<string, unknown>;

  switch (actionType) {
    case "signup":
      template = "verify_email";
      props = { actionUrl: buildVerifyUrl(data.token_hash, actionType, data.redirect_to) };
      break;
    case "magiclink":
      template = "magic_link";
      props = { actionUrl: buildVerifyUrl(data.token_hash, actionType, data.redirect_to) };
      break;
    case "recovery":
      template = "reset_password";
      props = { actionUrl: buildVerifyUrl(data.token_hash, actionType, data.redirect_to) };
      break;
    case "email_change":
    case "email_change_new":
      template = "change_email";
      props = {
        actionUrl: buildVerifyUrl(
          data.token_hash_new || data.token_hash,
          "email_change",
          data.redirect_to,
        ),
        newEmail: data.new_email,
      };
      break;
    case "reauthentication":
      template = "reauthentication";
      props = { token: data.token };
      break;
    case "invite":
      template = "workspace_invite";
      props = {
        actionUrl: buildVerifyUrl(data.token_hash, actionType, data.redirect_to),
        workspaceName: "your workspace",
        role: "member",
      };
      break;
    default:
      console.warn(`[AdeHQ auth hook] unhandled email_action_type: ${actionType}`);
      return hookError(`Unsupported email action: ${actionType}`, 422);
  }

  // 3) Render + send. sendEmail already logs failures to email_send_log.
  const result = await sendEmail({
    template,
    to,
    // Props are validated by construction above; the registry types the shape.
    props: props as never,
  });

  if (!result.delivered) {
    return hookError("Failed to send email", 500);
  }

  return NextResponse.json({}, { status: 200 });
}
