import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { ensureFirstProjectRoom } from "@/lib/server/ensure-first-room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      name?: string;
      accent?: string;
      description?: string;
    };

    if (!body.workspaceId?.trim()) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const serviceClient = createSupabaseSecretClient();
    const result = await ensureFirstProjectRoom(serviceClient, {
      workspaceId: body.workspaceId,
      userId: user.id,
      name: body.name,
      accent: body.accent,
      description: body.description,
    });

    return NextResponse.json({
      ok: true,
      roomId: result.roomId,
      roomName: result.roomName,
      created: result.created,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const pg =
      error && typeof error === "object" && "code" in error
        ? {
            code: String((error as { code?: unknown }).code ?? ""),
            message: String((error as { message?: unknown }).message ?? ""),
          }
        : null;
    console.error("[AdeHQ ensure-first-room]", pg ?? error);
    return NextResponse.json({ error: "Unable to ensure first room." }, { status: 500 });
  }
}
