import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { isBrainVoiceV1Enabled } from "@/lib/brain/flags";
import { executeTextToSpeech } from "@/lib/brain/voice/execute";
import { persistTtsArtifact } from "@/lib/brain/voice/persist";
import { safeApiErrorMessage } from "@/lib/server/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TTS for Listen / narration. Text remains authoritative; audio is an attachment.
 * Never autoplays — client controls playback.
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

    const body = (await request.json()) as {
      text?: string;
      intent?: "read_aloud" | "narration" | "premium_voiceover";
      messageId?: string;
      roomId?: string;
      topicId?: string;
      employeeId?: string;
      confirmed?: boolean;
    };

    const text = String(body.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }

    const { policy, result } = await executeTextToSpeech({
      client,
      workspaceId,
      request: {
        intent: body.intent ?? "read_aloud",
        text,
        confirmed: body.confirmed ?? true,
      },
      userId: user.id,
      employeeId: body.employeeId,
      roomId: body.roomId,
      topicId: body.topicId,
      messageId: body.messageId,
    });

    if (!result) {
      const status = policy.action === "confirm_estimate" ? 402 : 422;
      return NextResponse.json(
        {
          error: policy.reason ?? "Speech synthesis unavailable",
          needsConfirmation: policy.action === "confirm_estimate",
          policy,
        },
        { status },
      );
    }

    const persisted = await persistTtsArtifact(client, {
      workspaceId,
      userId: user.id,
      employeeId: body.employeeId,
      roomId: body.roomId,
      topicId: body.topicId,
      messageId: body.messageId,
      text,
      tts: result,
    });

    return NextResponse.json({
      signedUrl: persisted.signedUrl,
      artifactId: persisted.artifactId,
      exportId: persisted.exportId,
      mimeType: result.mimeType,
      estimatedWh: result.estimatedWh,
      memberLabel: result.memberLabel,
      autoplay: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ voice/synthesize]", error);
    return NextResponse.json(
      { error: safeApiErrorMessage(error, "Speech synthesis failed. Please try again.") },
      { status: 500 },
    );
  }
}
