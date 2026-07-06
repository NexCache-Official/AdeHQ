import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import {
  assertPlatformAdminCanWrite,
  requirePlatformAdmin,
} from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH — disable/enable a user account via Supabase Auth ban.
 * Disabling bans sign-in for 100 years; enabling clears the ban.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } },
) {
  try {
    const { admin, serviceClient } = await requirePlatformAdmin(request);
    assertPlatformAdminCanWrite(admin);

    const body = await request.json().catch(() => null);
    if (typeof body?.disabled !== "boolean") {
      return NextResponse.json({ error: "disabled (boolean) is required." }, { status: 400 });
    }
    if (params.userId === admin.userId) {
      return NextResponse.json(
        { error: "You cannot disable your own account." },
        { status: 400 },
      );
    }

    const { error } = await serviceClient.auth.admin.updateUserById(params.userId, {
      ban_duration: body.disabled ? "876000h" : "none",
    });
    if (error) throw error;

    await writeAuditLog(serviceClient, {
      adminUserId: admin.userId,
      action: body.disabled ? "user_disabled" : "user_enabled",
      targetType: "user",
      targetId: params.userId,
      after: { disabled: body.disabled },
      reason: typeof body?.reason === "string" ? body.reason : undefined,
      request,
    });

    return NextResponse.json({ ok: true, disabled: body.disabled });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Control] user patch", error);
    return NextResponse.json({ error: "User update failed." }, { status: 500 });
  }
}
