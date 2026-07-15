import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { AccountLifecycleError } from "@/lib/server/account-lifecycle";
import { createWorkspaceForUser } from "@/lib/server/workspace-bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Always creates a new workspace (not idempotent). Bootstrap remains for first-run only. */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as { workspaceName?: string };
    const name = typeof body.workspaceName === "string" ? body.workspaceName.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Workspace name is required." }, { status: 400 });
    }

    const serviceClient = createSupabaseSecretClient();
    const result = await createWorkspaceForUser(serviceClient, user, name);

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
    console.error("[AdeHQ workspace create]", error);
    return NextResponse.json({ error: "Unable to create workspace." }, { status: 500 });
  }
}
