import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { permanentlyDeleteTopic, topicFromRow } from "@/lib/server/topic-helpers";
import { mapTopicCreateError } from "@/lib/server/supabase-errors";
import { isGeneralTopic } from "@/lib/topics";
import { nowISO } from "@/lib/utils";
import type { TopicPriority, TopicStatus } from "@/lib/types";

export const runtime = "nodejs";

async function loadTopic(client: import("@supabase/supabase-js").SupabaseClient, topicId: string) {
  const { data, error } = await client
    .from("topics")
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
  metadata?: Record<string, unknown>;
  aiParticipationMode?: import("@/lib/types").AiParticipationMode;
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
      if (!isAdmin && !isCreator) {
        return NextResponse.json({ error: "You cannot change this topic status." }, { status: 403 });
      }
      if (body.status === "archived" && isGeneralTopic(topic)) {
        return NextResponse.json(
          { error: "General chat cannot be archived." },
          { status: 400 },
        );
      }
      patch.status = body.status;
    }
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.pinnedSummary !== undefined) patch.pinned_summary = body.pinnedSummary;
    if (body.metadata !== undefined || body.aiParticipationMode !== undefined) {
      const nextMeta = { ...(topic.metadata ?? {}), ...(body.metadata ?? {}) };
      if (body.aiParticipationMode !== undefined) {
        nextMeta.aiParticipationMode = body.aiParticipationMode;
      }
      patch.metadata = nextMeta;
    }

    const { data, error } = await client
      .from("topics")
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
    const mapped = mapTopicCreateError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
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

    const isAdmin = role === "owner" || role === "admin";
    const isCreator = topic.createdById === user.id;
    if (!isAdmin && !isCreator) {
      return NextResponse.json({ error: "You cannot modify this topic." }, { status: 403 });
    }

    if (isGeneralTopic(topic)) {
      return NextResponse.json(
        { error: "General chat cannot be archived or deleted." },
        { status: 400 },
      );
    }

    const permanent = request.nextUrl.searchParams.get("permanent") === "true";

    if (permanent) {
      await permanentlyDeleteTopic(client, topic.workspaceId, topic.id, topic.roomId);
      return NextResponse.json({ deleted: true, topicId: topic.id });
    }

    const { data, error } = await client
      .from("topics")
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
    const mapped = mapTopicCreateError(error);
    return NextResponse.json(
      {
        error: mapped.message.includes("Unable to create topic")
          ? "Unable to delete topic."
          : mapped.message,
      },
      { status: mapped.status },
    );
  }
}
