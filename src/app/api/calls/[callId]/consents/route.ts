import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { setConsent } from "@/lib/calls";

const schema = z.object({
  consentType: z.enum(["ai_listening", "transcription", "recording"]),
  granted: z.boolean(),
  retentionPolicy: z
    .enum(["session_only", "30_days", "workspace_default"])
    .optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const { data: participant, error: participantError } = await service
      .from("call_participants")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (participantError) throw participantError;
    if (!participant) throw new AuthError("Call not found.", 404);
    const { data, error } = await service
      .from("call_consents")
      .select("user_id, consent_type, granted, retention_policy, revoked_at")
      .eq("workspace_id", workspaceId)
      .eq("call_id", params.callId);
    if (error) throw error;
    return NextResponse.json({ consents: data ?? [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load consent state." }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid consent.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    return NextResponse.json(
      await setConsent(createSupabaseSecretClient(), {
        workspaceId,
        callId: params.callId,
        userId: user.id,
        ...parsed.data,
      }),
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not save consent." }, { status: 500 });
  }
}
