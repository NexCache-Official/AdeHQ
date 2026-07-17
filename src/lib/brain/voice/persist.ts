import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { DRIVE_BUCKETS } from "@/lib/drive/constants";
import { exportStoragePath } from "@/lib/drive/storage-sync";
import { recordStorageUsage } from "@/lib/drive/quota-server";
import { nowISO } from "@/lib/utils";
import type { SpeechToTextResult, TextToSpeechResult } from "./types";

export type PersistedAudioArtifact = {
  artifactId: string;
  exportId: string;
  storagePath: string;
  signedUrl?: string;
};

function audioStoragePath(workspaceId: string, id: string, ext: string): string {
  return `${workspaceId}/audio/${id}.${ext.replace(/^\./, "")}`;
}

/**
 * Store private audio (voice note / TTS) under adehq-audio.
 * Never public; signed URLs only. Retention metadata for deletion jobs.
 */
export async function persistPrivateAudio(params: {
  client: SupabaseClient;
  workspaceId: string;
  bytes: Buffer;
  mimeType: string;
  roomId?: string | null;
  topicId?: string | null;
  userId?: string | null;
  retentionDays?: number;
  kind: "voice_note" | "tts" | "meeting";
}): Promise<{ storagePath: string; exportId: string; signedUrl: string | null }> {
  const exportId = randomUUID();
  const ext =
    params.mimeType.includes("wav")
      ? "wav"
      : params.mimeType.includes("ogg")
        ? "ogg"
        : params.mimeType.includes("webm")
          ? "webm"
          : "mp3";
  const storagePath = audioStoragePath(params.workspaceId, exportId, ext);
  const bucket = DRIVE_BUCKETS.audio;

  const { error: upError } = await params.client.storage
    .from(bucket)
    .upload(storagePath, params.bytes, {
      contentType: params.mimeType,
      upsert: false,
    });
  if (upError) throw upError;

  const expiresAt = new Date(
    Date.now() + (params.retentionDays ?? 90) * 24 * 60 * 60 * 1000,
  ).toISOString();

  const exportPath = exportStoragePath(
    params.workspaceId,
    exportId,
    `audio-${params.kind}`,
    ext,
  );

  // Mirror lightweight export index for Drive (binary still private in adehq-audio)
  await params.client.from("drive_exports").insert({
    workspace_id: params.workspaceId,
    id: exportId,
    title: `Audio (${params.kind})`,
    mime_type: params.mimeType,
    storage_bucket: bucket,
    storage_path: storagePath,
    byte_size: params.bytes.length,
    created_by_type: params.userId ? "human" : "ai",
    created_by_id: params.userId ?? null,
    room_id: params.roomId ?? null,
    topic_id: params.topicId ?? null,
    metadata: {
      kind: "audio",
      audioKind: params.kind,
      privateAudio: true,
      retentionExpiresAt: expiresAt,
      noTraining: true,
      noWorkspaceIndex: params.kind === "voice_note",
    },
    created_at: nowISO(),
  });

  await recordStorageUsage({
    workspaceId: params.workspaceId,
    userId: params.userId,
    eventType: "export",
    bucket,
    objectPath: storagePath,
    sizeBytes: params.bytes.length,
    deltaBytes: params.bytes.length,
    entityType: "drive_export",
    entityId: exportId,
    metadata: { kind: "audio", audioKind: params.kind },
  }).catch(() => undefined);

  const { data: signed } = await params.client.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 30);

  void exportPath;
  return {
    storagePath,
    exportId,
    signedUrl: signed?.signedUrl ?? null,
  };
}

export async function persistMeetingTranscriptArtifact(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId?: string | null;
    userId?: string | null;
    roomId?: string | null;
    topicId?: string | null;
    title: string;
    stt: SpeechToTextResult;
    summary?: string;
    decisions?: string[];
    actionItems?: string[];
  },
): Promise<{ artifactId: string }> {
  const artifactId = randomUUID();
  const md = [
    `# ${params.title}`,
    "",
    `**Transcription** · ${params.stt.durationSeconds.toFixed(0)}s · ~${params.stt.estimatedWh.toFixed(2)} WH`,
    "",
    "## Transcript",
    "",
    params.stt.transcript,
    "",
    params.summary ? "## Summary\n\n" + params.summary : null,
    params.decisions?.length
      ? "## Decisions\n\n" + params.decisions.map((d) => `- ${d}`).join("\n")
      : null,
    params.actionItems?.length
      ? "## Action items\n\n" + params.actionItems.map((a) => `- ${a}`).join("\n")
      : null,
    "",
    "## Segments",
    "",
    ...params.stt.segments.map(
      (s) =>
        `- [${(s.startMs / 1000).toFixed(1)}s–${(s.endMs / 1000).toFixed(1)}s]${
          s.speakerId ? ` ${s.speakerId}:` : ""
        } ${s.text}`,
    ),
    "",
    "_Provider model names are admin-only._",
  ]
    .filter((l) => l != null)
    .join("\n");

  await client.from("artifacts").insert({
    workspace_id: params.workspaceId,
    id: artifactId,
    room_id: params.roomId ?? null,
    topic_id: params.topicId ?? null,
    title: params.title,
    artifact_type: "audio",
    status: "ready",
    content_markdown: md,
    content_json: {
      kind: "meeting_transcript",
      durationSeconds: params.stt.durationSeconds,
      segments: params.stt.segments,
      estimatedWh: params.stt.estimatedWh,
    },
    created_by_type: params.employeeId ? "ai" : "human",
    created_by_id: params.employeeId ?? params.userId ?? null,
    source_file_ids: [],
    source_message_ids: [],
    metadata: {
      kind: "audio",
      voice: true,
      noTraining: true,
    },
  });

  return { artifactId };
}

export async function persistTtsArtifact(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId?: string | null;
    userId?: string | null;
    roomId?: string | null;
    topicId?: string | null;
    messageId?: string | null;
    text: string;
    tts: TextToSpeechResult;
    retentionDays?: number;
  },
): Promise<PersistedAudioArtifact> {
  const stored = await persistPrivateAudio({
    client,
    workspaceId: params.workspaceId,
    bytes: params.tts.bytes,
    mimeType: params.tts.mimeType,
    roomId: params.roomId,
    topicId: params.topicId,
    userId: params.userId,
    retentionDays: params.retentionDays,
    kind: "tts",
  });

  const artifactId = randomUUID();
  await client.from("artifacts").insert({
    workspace_id: params.workspaceId,
    id: artifactId,
    room_id: params.roomId ?? null,
    topic_id: params.topicId ?? null,
    title: "Spoken reply",
    artifact_type: "audio",
    status: "ready",
    content_markdown: `# Spoken reply\n\n${params.text.slice(0, 2000)}`,
    content_json: {
      kind: "tts",
      exportId: stored.exportId,
      utf8Bytes: params.tts.utf8Bytes,
      estimatedWh: params.tts.estimatedWh,
      sourceMessageId: params.messageId,
    },
    created_by_type: params.employeeId ? "ai" : "human",
    created_by_id: params.employeeId ?? params.userId ?? null,
    metadata: {
      kind: "audio",
      binaryExportId: stored.exportId,
      privateAudio: true,
      noTraining: true,
    },
  });

  return {
    artifactId,
    exportId: stored.exportId,
    storagePath: stored.storagePath,
    signedUrl: stored.signedUrl ?? undefined,
  };
}
