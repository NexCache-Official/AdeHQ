import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AccountLifecycleError } from "@/lib/server/account-lifecycle";
import { bootstrapWorkspaceForUser } from "@/lib/server/workspace-bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as { workspaceName?: string };

    const serviceClient = createServiceRoleClient();
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
