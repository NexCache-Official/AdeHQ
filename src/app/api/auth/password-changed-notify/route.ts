import { NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import { requireAuthUser, AuthError } from "@/lib/supabase/auth-server";
import { sendEmail } from "@/lib/email/send";

export const runtime = "nodejs";

/** Notify the user after a password reset via recovery link (client updates password first). */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);

    if (!user.email) {
      return NextResponse.json({ ok: true });
    }

    await sendEmail({
      template: "password_changed",
      to: user.email,
      userId: user.id,
      props: {
        timestamp: new Date().toUTCString(),
        resetUrl: `${getSiteUrl()}/forgot-password`,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ password-changed-notify]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send notification." },
      { status: 500 },
    );
  }
}
