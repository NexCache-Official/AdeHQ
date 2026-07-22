import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  getRequestWorkspaceId,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import {
  createHumanCall,
  heartbeatLease,
  listCalls,
  resolveHumanCallEntitlements,
  updateCallState,
} from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  roomId: z.string().min(1),
  peerUserId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
  video: z.boolean().optional(),
});

const updateSchema = z.object({
  callId: z.string().min(1),
  action: z.enum(["active", "reconnecting", "declined", "cancelled", "ended", "failed", "heartbeat"]),
  deviceId: z.string().min(4).max(200).optional(),
});

function failure(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[AdeHQ human calls]", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Call request failed." },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const [calls, entitlements] = await Promise.all([
      listCalls(service, workspaceId, user.id),
      resolveHumanCallEntitlements(service, workspaceId),
    ]);
    return NextResponse.json({ calls, entitlements });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid call request.", 400);
    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const rateLimit = await consumeRateLimit(service, {
      bucket: "human-call-create",
      key: `${workspaceId}:${user.id}`,
      limit: 10,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit, "Too many calls started. Please wait a moment.");
    }
    const call = await createHumanCall(service, client, {
      workspaceId,
      roomId: parsed.data.roomId,
      creatorId: user.id,
      peerUserId: parsed.data.peerUserId,
      role,
      idempotencyKey: parsed.data.idempotencyKey,
      video: parsed.data.video,
    });
    return NextResponse.json(call, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = getRequestWorkspaceId(request);
    if (!workspaceId) throw new AuthError("workspaceId required.", 400);
    const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new AuthError("Invalid call update.", 400);
    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    if (parsed.data.action === "heartbeat") {
      if (!parsed.data.deviceId) throw new AuthError("deviceId required.", 400);
      return NextResponse.json(
        await heartbeatLease(service, {
          workspaceId,
          callId: parsed.data.callId,
          userId: user.id,
          deviceId: parsed.data.deviceId,
        }),
      );
    }
    return NextResponse.json(
      await updateCallState(service, {
        workspaceId,
        callId: parsed.data.callId,
        userId: user.id,
        status: parsed.data.action,
        deviceId: parsed.data.deviceId,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
