import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { topicFromRow } from "@/lib/server/topic-helpers";
import { nowISO } from "@/lib/utils";
import type { TopicPriority, TopicStatus } from "@/lib/types";

export const runtime = "nodejs";

async function loadTopic(client: import("@supabase/supabase-js").SupabaseClient, topicId: string) {
  const { data, error } = await client
    .from("room_topics")
    .select("*")
    .eq("id", topicId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return topicFromRow(data);
}

type PatchTopicBody = {
  title?: string;
  description?: string;
  status?: TopicStatus;
  priority?: TopicPriority;
  summary?: string;
  pinnedSummary?: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const topic = await loadTopic(client, params.topicId);
    if (!topic) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const { role } = await requireWorkspaceMembership(client, topic.workspaceId, user.id);
    await assertCanAccessRoom(client, topic.workspaceId, topic.roomId, user.id, role);

    const body = (await request.json()) as PatchTopicBody;
    const isAdmin = role === "owner" || role === "admin";
    const isCreator = topic.createdById === user.id;

    if (!isAdmin && !isCreator) {
      return NextResponse.json({ error: "You cannot update this topic." }, { status: 403 });
    }

    const patch: Record<string, unknown> = { updated_at: nowISO() };
    if (body.title !== undefined) patch.title = body.title.trim();
    if (body.description !== undefined) patch.description = body.description?.trim() || null;
    if (body.status !== undefined) {
      if (!isAdmin && body.status === "archived") {
        return NextResponse.json({ error: "Only admins can archive topics." }, { status: 403 });
      }
      patch.status = body.status;
    }
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.pinnedSummary !== undefined) patch.pinned_summary = body.pinnedSummary;

    const { data, error } = await client
      .from("room_topics")
      .update(patch)
      .eq("id", params.topicId)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ topic: topicFromRow(data) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic PATCH]", error);
    return NextResponse.json({ error: "Unable to update topic." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const topic = await loadTopic(client, params.topicId);
    if (!topic) {
      return NextResponse.json({ error: "Topic not found." }, { status: 404 });
    }

    const { role } = await requireWorkspaceMembership(client, topic.workspaceId, user.id);
    await assertCanAccessRoom(client, topic.workspaceId, topic.roomId, user.id, role);

    if (role !== "owner" && role !== "admin" && topic.createdById !== user.id) {
      return NextResponse.json({ error: "You cannot archive this topic." }, { status: 403 });
    }

    const { data, error } = await client
      .from("room_topics")
      .update({ status: "archived", updated_at: nowISO() })
      .eq("id", params.topicId)
      .select("*")
      .single();
    if (error) throw error;

    return NextResponse.json({ topic: topicFromRow(data) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ topic DELETE]", error);
    return NextResponse.json({ error: "Unable to archive topic." }, { status: 500 });
  }
}
