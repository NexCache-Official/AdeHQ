import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ensureMayaWorkspaceBundle } from "@/lib/server/ensure-maya";
import { resolveUserFirstName } from "@/lib/server/resolve-user-first-name";

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

    const firstName = await resolveUserFirstName(serviceClient, user, body.firstName);

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
    const detail =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message: string }).message === "string"
        ? (error as { message: string }).message
        : undefined;
    return NextResponse.json(
      { error: "Unable to ensure Maya.", detail: process.env.NODE_ENV === "development" ? detail : undefined },
      { status: 500 },
    );
  }
}
