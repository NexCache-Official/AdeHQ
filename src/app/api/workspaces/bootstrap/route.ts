import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { AccountLifecycleError } from "@/lib/server/account-lifecycle";
import { bootstrapWorkspaceForUser } from "@/lib/server/workspace-bootstrap";
import { isPlatformFlagEnabled, preloadPlatformFlags } from "@/lib/admin/platform-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const serviceClient = createSupabaseSecretClient();
    await preloadPlatformFlags(serviceClient);

    if (!(await isPlatformFlagEnabled("signups_enabled", serviceClient))) {
      return NextResponse.json(
        { error: "New signups are temporarily disabled." },
        { status: 503 },
      );
    }

    const { user } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as { workspaceName?: string };
    const result = await bootstrapWorkspaceForUser(
      serviceClient,
      user,
      body.workspaceName,
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AccountLifecycleError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[AdeHQ workspace bootstrap]", error);
    return NextResponse.json({ error: "Unable to create workspace." }, { status: 500 });
  }
}
