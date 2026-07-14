import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ labelId: string }> },
) {
  try {
    const { labelId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      name?: string;
      color?: string | null;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "organize");
    const patch: Record<string, unknown> = {};
    if (body.name?.trim()) patch.name = body.name.trim();
    if (body.color !== undefined) patch.color = body.color;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const { data, error } = await ctx.secret
      .from("email_labels")
      .update(patch)
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", labelId)
      .select("id, name, color")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      label: {
        id: String(data.id),
        name: String(data.name),
        color: data.color ? String(data.color) : null,
      },
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ labelId: string }> },
) {
  try {
    const { labelId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? undefined;
    const ctx = await resolveInboxRoute(request, workspaceId, "organize");
    const { error } = await ctx.secret
      .from("email_labels")
      .delete()
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", labelId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
