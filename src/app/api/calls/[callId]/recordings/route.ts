import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getCall, resolveHumanCallEntitlements } from "@/lib/calls";
import { uid } from "@/lib/utils";
import { upsertWorkGraphEdge } from "@/lib/inbox/work-graph";

export const runtime = "nodejs";
export const maxDuration = 60;

const RETENTION_DAYS: Record<string, number | null> = {
  session_only: 1,
  "30_days": 30,
  workspace_default: 30,
};
const RECORDING_MIME_TYPES = new Set(["audio/webm", "video/webm", "video/mp4", "audio/mp4"]);

async function requireRecordingAccess(request: NextRequest, callId: string) {
  const { user, client } = await requireAuthUser(request);
  const workspaceId = getRequestWorkspaceId(request);
  if (!workspaceId) throw new AuthError("workspaceId required.", 400);
  const membership = await requireWorkspaceMembership(client, workspaceId, user.id);
  const service = createSupabaseSecretClient();
  const call = await getCall(service, workspaceId, callId);
  if (!call.participants.some((participant) => participant.userId === user.id)) {
    throw new AuthError("Call not found.", 404);
  }
  return { user, workspaceId, membership, service, call };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { workspaceId, service } = await requireRecordingAccess(request, params.callId);
    const { data, error } = await service
      .from("call_artifacts")
      .select("id, title, owner_id, metadata, created_at")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .contains("metadata", { source: "call_recording" })
      .order("created_at", { ascending: false });
    if (error) throw error;
    const now = Date.now();
    const recordings = await Promise.all(
      (data ?? []).map(async (recording) => {
        const metadata = (recording.metadata ?? {}) as Record<string, unknown>;
        const expiresAt = metadata.retentionExpiresAt
          ? String(metadata.retentionExpiresAt)
          : null;
        if (expiresAt && new Date(expiresAt).getTime() <= now) {
          const expiredPath = String(metadata.storagePath ?? "");
          if (expiredPath) {
            await service.storage.from("call-recordings").remove([expiredPath]);
          }
          await service
            .from("call_artifacts")
            .delete()
            .eq("workspace_id", workspaceId)
            .eq("id", recording.id);
          return null;
        }
        const storagePath = String(metadata.storagePath ?? "");
        const { data: signed } = storagePath
          ? await service.storage.from("call-recordings").createSignedUrl(storagePath, 300)
          : { data: null };
        return {
          id: recording.id,
          title: recording.title,
          ownerId: recording.owner_id,
          createdAt: recording.created_at,
          retentionExpiresAt: expiresAt,
          downloadUrl: signed?.signedUrl ?? null,
        };
      }),
    );
    return NextResponse.json({ recordings: recordings.filter(Boolean) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load recordings." }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, workspaceId, service, call } = await requireRecordingAccess(
      request,
      params.callId,
    );
    const entitlements = await resolveHumanCallEntitlements(service, workspaceId);
    if (!entitlements.recordingEnabled) {
      throw new AuthError("Recording is not enabled for this workspace.", 403);
    }
    const humans = call.participants.filter((participant) => participant.userId);
    const { data: consentRows, error: consentError } = await service
      .from("call_consents")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("consent_type", "recording")
      .eq("granted", true);
    if (consentError) throw consentError;
    const consented = new Set((consentRows ?? []).map((row) => String(row.user_id)));
    if (!humans.every((participant) => consented.has(participant.userId!))) {
      throw new AuthError("Every human participant must consent before recording.", 409);
    }
    const form = await request.formData();
    const file = form.get("file");
    const retentionPolicy = String(form.get("retentionPolicy") ?? "workspace_default");
    if (!(file instanceof File) || file.size < 1) {
      throw new AuthError("Recording file required.", 400);
    }
    if (file.size > 250 * 1024 * 1024) {
      throw new AuthError("Recording exceeds the 250 MB web upload limit.", 413);
    }
    if (!RECORDING_MIME_TYPES.has(file.type)) {
      throw new AuthError("Unsupported recording format.", 415);
    }
    if (!(retentionPolicy in RETENTION_DAYS)) {
      throw new AuthError("Invalid recording retention policy.", 400);
    }
    const extension = file.type.includes("mp4") ? "mp4" : "webm";
    const artifactId = uid("call_art");
    const storagePath = `${workspaceId}/${params.callId}/${artifactId}.${extension}`;
    const { error: uploadError } = await service.storage
      .from("call-recordings")
      .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || "video/webm",
        upsert: false,
      });
    if (uploadError) throw uploadError;
    const days = RETENTION_DAYS[retentionPolicy];
    const retentionExpiresAt =
      days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString();
    const { error: artifactError } = await service.from("call_artifacts").insert({
      workspace_id: workspaceId,
      id: artifactId,
      call_id: params.callId,
      room_id: call.roomId,
      artifact_type: "artifact",
      visibility: "shared",
      title: "Call recording",
      content: "",
      owner_id: user.id,
      metadata: {
        source: "call_recording",
        storagePath,
        mimeType: file.type,
        retentionPolicy,
        retentionExpiresAt,
      },
    });
    if (artifactError) {
      await service.storage.from("call-recordings").remove([storagePath]);
      throw artifactError;
    }
    await upsertWorkGraphEdge(service, {
      workspaceId,
      fromObjectType: "call",
      fromObjectId: params.callId,
      relationType: "produced_recording",
      toObjectType: "call_artifact",
      toObjectId: artifactId,
      metadata: { roomId: call.roomId, retentionPolicy },
    });
    const now = new Date().toISOString();
    await service
      .from("call_sessions")
      .update({
        privacy_mode: "recorded_work_session",
        updated_at: now,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", params.callId);
    await service.from("call_events").insert({
      workspace_id: workspaceId,
      id: uid("call_evt"),
      call_id: params.callId,
      event_type: "call.recording_saved",
      actor_type: "human",
      actor_id: user.id,
      payload: { artifactId, retentionPolicy, retentionExpiresAt },
    });
    return NextResponse.json({ artifactId, retentionExpiresAt }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ call recording]", error);
    return NextResponse.json({ error: "Could not save recording." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, workspaceId, membership, service } = await requireRecordingAccess(
      request,
      params.callId,
    );
    const artifactId = request.nextUrl.searchParams.get("artifactId");
    if (!artifactId) throw new AuthError("artifactId required.", 400);
    const { data: artifact, error } = await service
      .from("call_artifacts")
      .select("owner_id, metadata")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("id", artifactId)
      .contains("metadata", { source: "call_recording" })
      .maybeSingle();
    if (error) throw error;
    if (!artifact) throw new AuthError("Recording not found.", 404);
    if (String(artifact.owner_id) !== user.id && membership.role !== "admin") {
      throw new AuthError("Only the recording owner or an admin can delete it.", 403);
    }
    const storagePath = String(
      ((artifact.metadata ?? {}) as Record<string, unknown>).storagePath ?? "",
    );
    if (storagePath) await service.storage.from("call-recordings").remove([storagePath]);
    const { error: deleteError } = await service
      .from("call_artifacts")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", artifactId);
    if (deleteError) throw deleteError;
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not delete recording." }, { status: 500 });
  }
}
