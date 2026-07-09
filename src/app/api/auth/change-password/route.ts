import { NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import { getPasswordStrength } from "@/lib/auth/password";
import { requireAuthUser, requirePasswordReauth, AuthError } from "@/lib/supabase/auth-server";
import { sendEmail } from "@/lib/email/send";

export const runtime = "nodejs";

type Body = {
  currentPassword?: string;
  newPassword?: string;
};

/** Change password for a signed-in user (settings). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const newPassword = body.newPassword?.trim();

    if (!newPassword) {
      return NextResponse.json({ error: "Enter a new password." }, { status: 400 });
    }

    const strength = getPasswordStrength(newPassword);
    if (!strength.passed) {
      return NextResponse.json(
        { error: "Use a stronger password: 8+ characters, a mix of character types, and no obvious patterns." },
        { status: 400 },
      );
    }

    const { user, client } = await requireAuthUser(request);
    await requirePasswordReauth(user, body.currentPassword);

    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (user.email) {
      await sendEmail({
        template: "password_changed",
        to: user.email,
        userId: user.id,
        props: {
          timestamp: new Date().toUTCString(),
          resetUrl: `${getSiteUrl()}/forgot-password`,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ change-password]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to change password." },
      { status: 500 },
    );
  }
}
