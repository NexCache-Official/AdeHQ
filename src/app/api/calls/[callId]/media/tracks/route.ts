import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { cloudflareSfuAdapter, getCall } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const descriptionSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(20),
});
const trackSchema = z.object({
  location: z.enum(["local", "remote"]),
  mid: z.string().optional(),
  trackName: z.string().min(1).max(200),
  sessionId: z.string().optional(),
});
const schema = z.object({
  sessionId: z.string().min(1),
  sessionDescription: descriptionSchema.optional(),
  tracks: z.array(trackSchema).min(1).max(50),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid track request.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const call = await getCall(service, workspaceId, params.callId);
    const participant = call.participants.find((item) => item.userId === user.id);
    if (!participant || participant.providerSessionId !== parsed.data.sessionId) {
      throw new AuthError("Media session not found.", 404);
    }
    const allowedRemoteSessions = new Set(
      call.participants
        .filter((item) => item.id !== participant.id)
        .map((item) => item.providerSessionId)
        .filter(Boolean),
    );
    for (const track of parsed.data.tracks) {
      if (track.location === "remote" && !allowedRemoteSessions.has(track.sessionId ?? null)) {
        throw new AuthError("Remote track is not part of this call.", 403);
      }
    }
    const result = await cloudflareSfuAdapter.addTracks(
      parsed.data.sessionId,
      parsed.data.tracks,
      parsed.data.sessionDescription,
    );
    const localTracks = parsed.data.tracks.filter((track) => track.location === "local");
    if (localTracks.length) {
      const now = new Date().toISOString();
      const publishedByName = new Map(
        participant.publishedTracks.map((track) => [track.trackName, track]),
      );
      for (const track of localTracks) publishedByName.set(track.trackName, track);
      const publishedTracks = [...publishedByName.values()];
      await service
        .from("call_participants")
        .update({
          published_tracks: publishedTracks,
          state: "joined",
          joined_at: now,
          updated_at: now,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", participant.id);
      await service
        .from("call_media_sessions")
        .update({ published_tracks: publishedTracks })
        .eq("workspace_id", workspaceId)
        .eq("participant_id", participant.id)
        .eq("provider_session_id", parsed.data.sessionId)
        .is("ended_at", null);
      await service
        .from("call_sessions")
        .update({
          status: "active",
          started_at: call.startedAt ?? now,
          last_activity_at: now,
          updated_at: now,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", params.callId);
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Cloudflare tracks]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update media tracks." },
      { status: 502 },
    );
  }
}
