import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { updateContentPost } from "@/lib/server/calendar-mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  workspaceId: z.string().min(1),
  scheduledAt: z.string().nullable().optional(),
  status: z
    .enum(["draft", "ready_for_approval", "approved", "scheduled_later", "published_later", "archived"])
    .optional(),
  title: z.string().min(1).optional(),
  platform: z.enum(["linkedin", "instagram", "facebook", "x", "blog", "email"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { postId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = PatchSchema.parse(await request.json());
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const post = await updateContentPost(client, body.workspaceId, params.postId, body);
    return NextResponse.json({ post });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[AdeHQ calendar post PATCH]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update post." },
      { status: 500 },
    );
  }
}
