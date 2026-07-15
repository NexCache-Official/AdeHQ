import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } },
) {
  try {
    const { user } = await requireAuthUser(request);
    const token = params.token?.trim();
    if (!token) {
      return NextResponse.json({ error: "Missing invitation token." }, { status: 400 });
    }

    const userEmail = user.email?.trim().toLowerCase();
    if (!userEmail) {
      return NextResponse.json({ error: "Your account has no email address." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const { data: invite, error } = await service
      .from("workspace_invitations")
      .select("id, invited_email, status")
      .eq("token", token)
      .maybeSingle();

    if (error) throw error;
    if (!invite) {
      return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    }

    if (String(invite.invited_email).trim().toLowerCase() !== userEmail) {
      return NextResponse.json(
        { error: "Sign in with the email address this invitation was sent to." },
        { status: 403 },
      );
    }

    if (invite.status !== "pending") {
      return NextResponse.json({ ok: true, status: invite.status });
    }

    const { error: updateError } = await service
      .from("workspace_invitations")
      .update({ status: "declined" })
      .eq("id", invite.id)
      .eq("status", "pending");
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, status: "declined" });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ invitation decline]", error);
    return NextResponse.json({ error: "Unable to decline invitation." }, { status: 500 });
  }
}
