import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? undefined;
    const ctx = await resolveInboxRoute(request, workspaceId, "read");
    const { data, error } = await ctx.secret
      .from("email_labels")
      .select("id, name, color, created_at")
      .eq("workspace_id", ctx.workspaceId)
      .order("name", { ascending: true });
    if (error) throw error;
    return NextResponse.json({
      labels: (data ?? []).map((l) => ({
        id: String(l.id),
        name: String(l.name),
        color: l.color ? String(l.color) : null,
      })),
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      name?: string;
      color?: string | null;
    };
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    const ctx = await resolveInboxRoute(request, body.workspaceId, "organize");
    const { data, error } = await ctx.secret
      .from("email_labels")
      .upsert(
        {
          workspace_id: ctx.workspaceId,
          name: body.name.trim(),
          color: body.color ?? null,
        },
        { onConflict: "workspace_id,name" },
      )
      .select("id, name, color")
      .single();
    if (error) throw error;
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
