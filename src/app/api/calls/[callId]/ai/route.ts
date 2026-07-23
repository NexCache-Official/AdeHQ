import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  inviteAiEmployee,
  toPersistedParticipationMode,
  type AiParticipationMode,
  type CallParticipationMode,
} from "@/lib/calls";

export const runtime = "nodejs";

const schema = z.object({
  roomId: z.string().min(1),
  employeeId: z.string().min(1),
  mode: z
    .enum([
      "silent_observer",
      "on_request",
      "advisor",
      "facilitator",
      "active",
      "quiet",
      "smart_assist",
      "council",
    ])
    .default("on_request"),
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
    if (!parsed.success) throw new AuthError("Invalid AI invitation.", 400);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    const mode = ["quiet", "smart_assist", "council"].includes(parsed.data.mode)
      ? toPersistedParticipationMode(parsed.data.mode as CallParticipationMode)
      : (parsed.data.mode as AiParticipationMode);
    return NextResponse.json(
      await inviteAiEmployee(createSupabaseSecretClient(), client, {
        workspaceId,
        callId: params.callId,
        roomId: parsed.data.roomId,
        userId: user.id,
        role,
        employeeId: parsed.data.employeeId,
        mode,
      }),
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not invite AI employee." }, { status: 500 });
  }
}
