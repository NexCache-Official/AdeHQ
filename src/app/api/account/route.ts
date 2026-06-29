import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  AccountLifecycleError,
  getAccountDeletionContext,
  purgeUserAccount,
} from "@/lib/server/account-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const serviceClient = createServiceRoleClient();
    const ctx = await getAccountDeletionContext(
      serviceClient,
      user.id,
      user.email ?? "",
    );

    return NextResponse.json(ctx);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ account GET]", error);
    return NextResponse.json({ error: "Unable to load account status." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      confirmEmail?: string;
      deleteOwnedWorkspaces?: boolean;
    };

    if (!body.confirmEmail?.trim()) {
      return NextResponse.json(
        { error: "Type your email address to confirm account deletion." },
        { status: 400 },
      );
    }

    const serviceClient = createServiceRoleClient();
    const result = await purgeUserAccount(serviceClient, user.id, user.email ?? "", {
      confirmEmail: body.confirmEmail,
      deleteOwnedWorkspaces: Boolean(body.deleteOwnedWorkspaces),
    });

    return NextResponse.json({
      ok: true,
      deletedWorkspaceIds: result.deletedWorkspaceIds,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AccountLifecycleError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    console.error("[AdeHQ account DELETE]", error);
    return NextResponse.json({ error: "Unable to delete account." }, { status: 500 });
  }
}
