import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import {
  channelFromRow,
  loadChannel,
  permanentlyDeleteChannel,
} from "@/lib/server/channel-helpers";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";
import { nowISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PatchChannelBody = {
  status?: "active" | "archived";
  name?: string;
  description?: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { channelId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = await getWorkspaceIdForRoom(client, params.channelId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    }

    const channel = await loadChannel(client, workspaceId, params.channelId);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    }
    if (channel.kind === "dm") {
      return NextResponse.json({ error: "Direct messages cannot be archived." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.channelId, user.id, role);

    const isAdmin = role === "owner" || role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Only workspace admins can update channels." }, { status: 403 });
    }

    const body = (await request.json()) as PatchChannelBody;
    const patch: Record<string, unknown> = { updated_at: nowISO() };
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.description !== undefined) patch.description = body.description?.trim() ?? "";
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await client
      .from("channels")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("id", params.channelId)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ channel: channelFromRow(data as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ channel PATCH]", error);
    return NextResponse.json({ error: "Unable to update channel." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { channelId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = await getWorkspaceIdForRoom(client, params.channelId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    }

    const channel = await loadChannel(client, workspaceId, params.channelId);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found." }, { status: 404 });
    }
    if (channel.kind === "dm") {
      return NextResponse.json({ error: "Direct messages cannot be deleted here." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.channelId, user.id, role);

    const isAdmin = role === "owner" || role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Only workspace admins can delete channels." }, { status: 403 });
    }

    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    if (permanent) {
      await permanentlyDeleteChannel(client, workspaceId, params.channelId);
      return NextResponse.json({ deleted: true, channelId: params.channelId });
    }

    const { data, error } = await client
      .from("channels")
      .update({ status: "archived", updated_at: nowISO() })
      .eq("workspace_id", workspaceId)
      .eq("id", params.channelId)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ channel: channelFromRow(data as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ channel DELETE]", error);
    const message = error instanceof Error ? error.message : "Unable to delete channel.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
