import type { SupabaseClient } from "@supabase/supabase-js";
import { executeSpeechToText } from "./execute";
import { persistMeetingTranscriptArtifact, persistPrivateAudio } from "./persist";
import type { SttIntent } from "./types";

function newVoiceJobId(): string {
  return `vjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Queue a long-audio meeting transcription job (async — not a sync chat call).
 */
export async function enqueueMeetingTranscriptionJob(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    roomId?: string | null;
    topicId?: string | null;
    employeeId?: string | null;
    audioBytes: Buffer;
    mimeType: string;
    fileName?: string;
    durationSeconds: number;
    estimatedWhMin: number;
    estimatedWhMax: number;
    title?: string;
  },
): Promise<{ jobId: string }> {
  const stored = await persistPrivateAudio({
    client,
    workspaceId: input.workspaceId,
    bytes: input.audioBytes,
    mimeType: input.mimeType,
    roomId: input.roomId,
    topicId: input.topicId,
    userId: input.userId,
    kind: "meeting",
  });

  const jobId = newVoiceJobId();
  const { error } = await client.from("brain_voice_jobs").insert({
    id: jobId,
    workspace_id: input.workspaceId,
    room_id: input.roomId ?? null,
    topic_id: input.topicId ?? null,
    initiated_by_user_id: input.userId,
    employee_id: input.employeeId ?? null,
    kind: "meeting_stt",
    status: "queued",
    route_id: "route_stt_diarized",
    audio_export_id: stored.exportId,
    estimated_wh_min: input.estimatedWhMin,
    estimated_wh_max: input.estimatedWhMax,
    result: {
      fileName: input.fileName,
      durationSeconds: input.durationSeconds,
      title: input.title ?? "Meeting transcript",
      mimeType: input.mimeType,
      storagePath: stored.storagePath,
    },
  });
  if (error) throw error;
  return { jobId };
}

/**
 * Process a queued voice job (called from worker / API drain).
 */
export async function processVoiceJob(
  client: SupabaseClient,
  workspaceId: string,
  jobId: string,
): Promise<{ ok: boolean; artifactId?: string; error?: string }> {
  const { data: job, error } = await client
    .from("brain_voice_jobs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!job) return { ok: false, error: "not_found" };
  if (job.status === "completed") {
    return { ok: true, artifactId: job.artifact_id ? String(job.artifact_id) : undefined };
  }
  if (job.status === "cancelled") return { ok: false, error: "cancelled" };

  await client
    .from("brain_voice_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    const resultMeta = (job.result ?? {}) as Record<string, unknown>;
    const storagePath = String(resultMeta.storagePath ?? "");
    const mimeType = String(resultMeta.mimeType ?? "audio/mpeg");
    const durationSeconds = Number(resultMeta.durationSeconds ?? 120);
    const title = String(resultMeta.title ?? "Meeting transcript");

    const { data: blob, error: dlError } = await client.storage
      .from("adehq-audio")
      .download(storagePath);
    if (dlError || !blob) throw new Error("Could not download meeting audio.");
    const audioBytes = Buffer.from(await blob.arrayBuffer());

    const intent: SttIntent = job.kind === "meeting_stt" ? "meeting" : "voice_note";
    const { result, policy } = await executeSpeechToText({
      client,
      workspaceId,
      request: {
        intent,
        audioBytes,
        mimeType,
        durationSecondsHint: durationSeconds,
        requireDiarization: intent === "meeting",
        confirmed: true,
        fileName: typeof resultMeta.fileName === "string" ? resultMeta.fileName : undefined,
      },
      userId: job.initiated_by_user_id ? String(job.initiated_by_user_id) : null,
      employeeId: job.employee_id ? String(job.employee_id) : null,
      roomId: job.room_id ? String(job.room_id) : null,
      topicId: job.topic_id ? String(job.topic_id) : null,
      skipPolicy: true,
    });

    if (!result) {
      throw new Error(policy.reason ?? "Transcription failed.");
    }

    // Lightweight summary scaffold — full LLM summary can plug in later
    const summary = result.transcript.slice(0, 480);
    const { artifactId } = await persistMeetingTranscriptArtifact(client, {
      workspaceId,
      userId: job.initiated_by_user_id ? String(job.initiated_by_user_id) : null,
      employeeId: job.employee_id ? String(job.employee_id) : null,
      roomId: job.room_id ? String(job.room_id) : null,
      topicId: job.topic_id ? String(job.topic_id) : null,
      title,
      stt: result,
      summary,
      decisions: [],
      actionItems: [],
    });

    await client
      .from("brain_voice_jobs")
      .update({
        status: "completed",
        artifact_id: artifactId,
        actual_wh: result.estimatedWh,
        result: { ...resultMeta, transcriptPreview: result.transcript.slice(0, 280) },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return { ok: true, artifactId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await client
      .from("brain_voice_jobs")
      .update({
        status: "failed",
        error_message: message.slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return { ok: false, error: message };
  }
}

export async function cancelVoiceJob(
  client: SupabaseClient,
  workspaceId: string,
  jobId: string,
): Promise<void> {
  await client
    .from("brain_voice_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      error_message: "Cancelled by user.",
    })
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .in("status", ["queued", "running"]);
}
