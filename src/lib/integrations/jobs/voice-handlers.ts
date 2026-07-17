// PR-18 — Speech synthesize / transcribe async jobs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { registerJobHandler, type JobHandlerResult } from "./registry";
import { executeTextToSpeech, executeSpeechToText } from "@/lib/brain/voice/execute";
import { persistTtsArtifact } from "@/lib/brain/voice/persist";
import { processVoiceJob } from "@/lib/brain/voice/jobs";
import { isBrainVoiceV1Enabled } from "@/lib/brain/flags";

type JobPayload = {
  tool?: string;
  args?: Record<string, unknown>;
  ctx?: {
    roomId?: string;
    topicId?: string;
    employeeId?: string;
    triggerMessageId?: string;
    brainRunId?: string;
  };
};

registerJobHandler("speech_synthesize", async (client, job): Promise<JobHandlerResult> => {
  if (!isBrainVoiceV1Enabled()) {
    throw new Error("Voice is disabled.");
  }
  const payload = (job.payload ?? {}) as JobPayload;
  const args = (payload.args ?? {}) as {
    intent?: "read_aloud" | "narration" | "premium_voiceover";
    text?: string;
  };
  const text = String(args.text ?? "").trim();
  if (!text) throw new Error("Missing text.");

  const { policy, result } = await executeTextToSpeech({
    client: client as SupabaseClient,
    workspaceId: job.workspaceId,
    request: {
      intent: args.intent ?? "read_aloud",
      text,
      confirmed: true,
    },
    employeeId: job.employeeId,
    roomId: payload.ctx?.roomId,
    topicId: payload.ctx?.topicId,
  });

  if (!result) {
    throw new Error(policy.reason ?? "Speech synthesis blocked.");
  }

  const persisted = await persistTtsArtifact(client as SupabaseClient, {
    workspaceId: job.workspaceId,
    employeeId: job.employeeId,
    roomId: payload.ctx?.roomId,
    topicId: payload.ctx?.topicId,
    text,
    tts: result,
  });

  return {
    result: {
      artifactId: persisted.artifactId,
      exportId: persisted.exportId,
      signedUrl: persisted.signedUrl ?? null,
      estimatedWh: result.estimatedWh,
      memberLabel: result.memberLabel,
    },
    costUsd: result.costUsd,
  };
});

registerJobHandler("speech_transcribe", async (client, job): Promise<JobHandlerResult> => {
  if (!isBrainVoiceV1Enabled()) {
    throw new Error("Voice is disabled.");
  }
  const payload = (job.payload ?? {}) as JobPayload;
  const args = (payload.args ?? {}) as {
    voiceJobId?: string;
    intent?: "voice_note" | "accurate" | "meeting";
    audioFileId?: string;
    durationSeconds?: number;
  };

  if (args.voiceJobId) {
    const processed = await processVoiceJob(
      client as SupabaseClient,
      job.workspaceId,
      args.voiceJobId,
    );
    if (!processed.ok) {
      throw new Error(processed.error ?? "Voice job failed.");
    }
    return {
      result: { artifactId: processed.artifactId ?? null, voiceJobId: args.voiceJobId },
    };
  }

  if (!args.audioFileId) {
    throw new Error("audioFileId or voiceJobId required.");
  }

  const { data: file } = await client
    .from("workspace_files")
    .select("storage_bucket, storage_path, mime_type, original_name")
    .eq("workspace_id", job.workspaceId)
    .eq("id", args.audioFileId)
    .maybeSingle();
  if (!file?.storage_path) {
    throw new Error("Audio file not found.");
  }

  const { data: blob, error: dlError } = await client.storage
    .from(String(file.storage_bucket || "adehq-files"))
    .download(String(file.storage_path));
  if (dlError || !blob) {
    throw new Error("Could not download audio.");
  }

  const { policy, result } = await executeSpeechToText({
    client: client as SupabaseClient,
    workspaceId: job.workspaceId,
    request: {
      intent: args.intent ?? "voice_note",
      audioBytes: Buffer.from(await blob.arrayBuffer()),
      mimeType: String(file.mime_type || "audio/webm"),
      fileName: file.original_name ? String(file.original_name) : undefined,
      durationSecondsHint: args.durationSeconds ?? 30,
      confirmed: true,
    },
    employeeId: job.employeeId,
    roomId: payload.ctx?.roomId,
    topicId: payload.ctx?.topicId,
  });

  if (!result) {
    throw new Error(policy.reason ?? "Transcription blocked.");
  }

  return {
    result: {
      transcript: result.transcript,
      durationSeconds: result.durationSeconds,
      estimatedWh: result.estimatedWh,
      memberLabel: result.memberLabel,
      segments: result.segments,
    },
    costUsd: result.costUsd,
  };
});
