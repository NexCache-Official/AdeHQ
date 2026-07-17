import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { isBrainVoiceV1Enabled } from "@/lib/brain/flags";
import { assessSttRequest, executeSpeechToText } from "@/lib/brain/voice/execute";
import { enqueueMeetingTranscriptionJob } from "@/lib/brain/voice/jobs";
import { persistPrivateAudio } from "@/lib/brain/voice/persist";
import { shouldUseAsyncStt } from "@/lib/brain/voice/select";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voice-note / meeting transcription.
 * Short notes: sync transcript for edit-before-send.
 * Long meetings: async job + Drive artifact.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isBrainVoiceV1Enabled()) {
      return NextResponse.json({ error: "Voice is not enabled." }, { status: 403 });
    }

    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    const intentRaw = String(form.get("intent") ?? "voice_note");
    const intent =
      intentRaw === "meeting" || intentRaw === "accurate" ? intentRaw : "voice_note";
    const durationSeconds = Math.max(
      1,
      Number(form.get("durationSeconds") ?? 30) || 30,
    );
    const confirmed = String(form.get("confirmed") ?? "") === "1";
    const roomId = form.get("roomId") ? String(form.get("roomId")) : null;
    const topicId = form.get("topicId") ? String(form.get("topicId")) : null;
    const title = form.get("title") ? String(form.get("title")) : undefined;

    const audioBytes = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "audio/webm";
    const useAsync = intent === "meeting" || shouldUseAsyncStt(durationSeconds);

    if (useAsync) {
      const policy = await assessSttRequest(client, workspaceId, {
        intent: intent === "meeting" ? "meeting" : "accurate",
        durationSecondsHint: durationSeconds,
        confirmed,
      });

      if (policy.action === "blocked") {
        return NextResponse.json({ error: policy.reason, policy }, { status: 402 });
      }
      if (policy.action === "confirm_estimate" && !confirmed) {
        return NextResponse.json({
          needsConfirmation: true,
          policy,
          asyncJob: true,
        });
      }

      const { jobId } = await enqueueMeetingTranscriptionJob(client, {
        workspaceId,
        userId: user.id,
        roomId,
        topicId,
        audioBytes,
        mimeType,
        fileName: file.name,
        durationSeconds,
        estimatedWhMin: policy.estimatedWhMin,
        estimatedWhMax: policy.estimatedWhMax,
        title,
      });

      void import("@/lib/brain/voice/jobs").then(({ processVoiceJob }) =>
        processVoiceJob(client, workspaceId, jobId),
      );

      return NextResponse.json({
        asyncJob: true,
        jobId,
        policy,
        message: "Meeting transcription started. A Drive artifact will appear when ready.",
      });
    }

    await persistPrivateAudio({
      client,
      workspaceId,
      bytes: audioBytes,
      mimeType,
      roomId,
      topicId,
      userId: user.id,
      kind: "voice_note",
    });

    const { policy, result } = await executeSpeechToText({
      client,
      workspaceId,
      request: {
        intent,
        audioBytes,
        mimeType,
        fileName: file.name,
        durationSecondsHint: durationSeconds,
        confirmed: true,
      },
      userId: user.id,
      roomId,
      topicId,
    });

    if (!result) {
      return NextResponse.json(
        { error: policy.reason ?? "Transcription failed", policy },
        { status: 422 },
      );
    }

    return NextResponse.json({
      asyncJob: false,
      transcript: result.transcript,
      language: result.language,
      confidence: result.confidence,
      durationSeconds: result.durationSeconds,
      segments: result.segments,
      estimatedWh: result.estimatedWh,
      memberLabel: result.memberLabel,
      editable: true,
      policy,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ voice/transcribe]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transcription failed" },
      { status: 500 },
    );
  }
}
