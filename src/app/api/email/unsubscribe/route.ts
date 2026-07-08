import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import {
  PREFERENCE_COLUMNS,
  isPreferenceCategory,
  CATEGORY_LABELS,
  type PreferenceCategory,
} from "@/lib/email/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe by token. Flips a single preference-gated category off
 * without requiring login. POST handles the RFC 8058 one-click form that Gmail
 * / Apple Mail submit from the List-Unsubscribe-Post header; GET is the
 * human-facing link that also shows a confirmation page.
 */

async function applyUnsubscribe(
  token: string | null,
  category: string | null,
): Promise<{ ok: boolean; category?: PreferenceCategory }> {
  if (!token || !category || !isPreferenceCategory(category)) {
    return { ok: false };
  }
  const service = createServiceRoleClient();
  const column = PREFERENCE_COLUMNS[category];

  const { data, error } = await service
    .from("email_preferences")
    .update({ [column]: false })
    .eq("unsubscribe_token", token)
    .select("user_id")
    .maybeSingle();

  if (error || !data) return { ok: false };
  return { ok: true, category };
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const result = await applyUnsubscribe(
    url.searchParams.get("token"),
    url.searchParams.get("category"),
  );
  return NextResponse.json({ ok: result.ok }, { status: result.ok ? 200 : 400 });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const result = await applyUnsubscribe(url.searchParams.get("token"), category);

  const label =
    result.category && CATEGORY_LABELS[result.category]
      ? CATEGORY_LABELS[result.category].title.toLowerCase()
      : "these emails";

  const body = result.ok
    ? confirmationPage({
        heading: "You're unsubscribed",
        message: `You won't receive ${label} from AdeHQ anymore. You can re-enable them anytime in your notification settings.`,
      })
    : confirmationPage({
        heading: "Link expired",
        message:
          "This unsubscribe link is no longer valid. Manage your email preferences from your account settings instead.",
      });

  return new NextResponse(body, {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function confirmationPage({ heading, message }: { heading: string; message: string }): string {
  const site = getSiteUrl();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${heading} · AdeHQ</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; background:#F8FAFC; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#334155; }
  .wrap { max-width:520px; margin:64px auto; padding:0 20px; }
  .card { background:#fff; border:1px solid #E2E8F0; border-radius:16px; padding:40px 32px; text-align:center; }
  h1 { margin:16px 0 8px; font-size:22px; color:#0F172A; }
  p { margin:0 0 20px; font-size:15px; line-height:22px; color:#64748B; }
  a.btn { display:inline-block; background:#2563EB; color:#fff; text-decoration:none; font-weight:600; font-size:15px; padding:12px 24px; border-radius:10px; }
  .mark { font-weight:700; color:#2563EB; letter-spacing:-0.01em; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="mark">AdeHQ</div>
      <h1>${heading}</h1>
      <p>${message}</p>
      <a class="btn" href="${site}/settings/notifications">Manage email preferences</a>
    </div>
  </div>
</body>
</html>`;
}
