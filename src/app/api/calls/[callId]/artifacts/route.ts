import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { createCallArtifact, getCall } from "@/lib/calls";

const schema = z.object({
  type: z.enum(["decision", "task", "question", "risk", "approval", "artifact", "memory", "summary", "note"]),
  title: z.string().min(1).max(200),
  content: z.string().max(20_000).optional(),
  visibility: z.enum(["private", "shared"]).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    if (!call.participants.some((participant) => participant.userId === user.id)) {
      throw new AuthError("Call not found.", 404);
    }
    const { data, error } = await service
      .from("call_artifacts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .or(`visibility.eq.shared,owner_id.eq.${user.id}`)
      .order("created_at");
    if (error) throw error;
    return NextResponse.json({ artifacts: data ?? [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load call work." }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid call artifact.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    return NextResponse.json(
      await createCallArtifact(createSupabaseSecretClient(), {
        workspaceId,
        callId: params.callId,
        userId: user.id,
        ...parsed.data,
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not create call artifact." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    const artifactId = request.nextUrl.searchParams.get("artifactId");
    if (!workspaceId || !artifactId) throw new AuthError("artifactId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const { data, error } = await service
      .from("call_artifacts")
      .update({ visibility: "shared", updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("id", artifactId)
      .eq("owner_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new AuthError("Private sidecar not found.", 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not share call work." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    const artifactId = request.nextUrl.searchParams.get("artifactId");
    if (!workspaceId || !artifactId) throw new AuthError("artifactId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const { error } = await service
      .from("call_artifacts")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("id", artifactId)
      .eq("owner_id", user.id)
      .eq("visibility", "private");
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not dismiss call work." }, { status: 500 });
  }
}
