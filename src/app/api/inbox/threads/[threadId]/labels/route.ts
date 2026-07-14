import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? undefined;
    const ctx = await resolveInboxRoute(request, workspaceId, "read");
    const { data, error } = await ctx.secret
      .from("email_thread_labels")
      .select("label_id, email_labels(id, name, color)")
      .eq("workspace_id", ctx.workspaceId)
      .eq("thread_id", threadId);
    if (error) throw error;
    const labels = (data ?? []).map((row) => {
      const label = row.email_labels as unknown as {
        id: string;
        name: string;
        color: string | null;
      } | null;
      return {
        id: String(label?.id ?? row.label_id),
        name: String(label?.name ?? ""),
        color: label?.color ? String(label.color) : null,
      };
    });
    return NextResponse.json({ labels });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      labelIds?: string[];
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "organize");
    const labelIds = Array.isArray(body.labelIds) ? body.labelIds.map(String) : [];

    await ctx.secret
      .from("email_thread_labels")
      .delete()
      .eq("workspace_id", ctx.workspaceId)
      .eq("thread_id", threadId);

    if (labelIds.length > 0) {
      const { error } = await ctx.secret.from("email_thread_labels").insert(
        labelIds.map((labelId) => ({
          workspace_id: ctx.workspaceId,
          thread_id: threadId,
          label_id: labelId,
        })),
      );
      if (error) throw error;
    }
    return NextResponse.json({ ok: true, labelIds });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
