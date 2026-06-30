import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ensureMayaWorkspaceBundle } from "@/lib/server/ensure-maya";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      firstName?: string;
    };

    const serviceClient = createServiceRoleClient();
    const { data: member, error: memberError } = await serviceClient
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberError) throw memberError;

    const workspaceId = body.workspaceId ?? member?.workspace_id;
    if (!workspaceId) {
      return NextResponse.json({ error: "No workspace found." }, { status: 404 });
    }

    const firstName =
      body.firstName ??
      (typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name.split(" ")[0]
        : "there");

    const result = await ensureMayaWorkspaceBundle(
      serviceClient,
      String(workspaceId),
      user.id,
      firstName,
    );

    return NextResponse.json({
      ok: true,
      employeeId: result.employee.id,
      dmRoomId: result.dmRoom.id,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ ensure-maya]", error);
    return NextResponse.json({ error: "Unable to ensure Maya." }, { status: 500 });
  }
}
