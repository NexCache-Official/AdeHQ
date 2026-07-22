import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { acquireBlueprintLock, releaseBlueprintLock } from "@/lib/hiring/workforce-studio/blueprint-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Acquire or heartbeat-refresh the draft lock. Call again before the 120s
 * TTL expires (e.g. every 45s) while the editor is open. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const { user, workspaceId } = await requireWorkforceStudioAdmin(request, getRequestWorkspaceId(request) ?? body.workspaceId);
    const service = createSupabaseSecretClient();
    const lock = await acquireBlueprintLock(service, workspaceId, params.id, user.id);
    return NextResponse.json(lock);
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]/lock");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string; lockToken?: string };
    const { workspaceId } = await requireWorkforceStudioAdmin(request, getRequestWorkspaceId(request) ?? body.workspaceId);
    if (!body.lockToken) return NextResponse.json({ ok: true });
    const service = createSupabaseSecretClient();
    await releaseBlueprintLock(service, workspaceId, params.id, body.lockToken);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]/lock");
  }
}
