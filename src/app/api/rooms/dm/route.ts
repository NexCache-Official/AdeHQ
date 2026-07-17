import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { ensurePrivateAiDm, ensurePrivateHumanDm } from "@/lib/server/ensure-private-dm";
import { getWorkspaceMemberRole } from "@/lib/server/room-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  employeeId: z.string().min(1).optional(),
  peerUserId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuthUser(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const { workspaceId, employeeId, peerUserId } = parsed.data;
    if (!employeeId && !peerUserId) {
      return NextResponse.json({ error: "employeeId or peerUserId required." }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    await requireWorkspaceMembership(service, workspaceId, user.id);
    const role = await getWorkspaceMemberRole(service, workspaceId, user.id);
    if (!role) throw new AuthError("You are not a member of this workspace.", 403);

    if (employeeId) {
      const { data: emp } = await service
        .from("ai_employees")
        .select("name, accent, instructions")
        .eq("workspace_id", workspaceId)
        .eq("id", employeeId)
        .maybeSingle();

      const room = await ensurePrivateAiDm(service, {
        workspaceId,
        userId: user.id,
        role,
        employeeId,
        employeeName: emp?.name ? String(emp.name) : undefined,
        accent: emp?.accent ? String(emp.accent) : undefined,
        brief: emp?.instructions ? String(emp.instructions) : undefined,
      });
      return NextResponse.json({ roomId: room.id, kind: "ai" });
    }

    const { data: peer } = await service
      .from("profiles")
      .select("name")
      .eq("id", peerUserId!)
      .maybeSingle();

    const room = await ensurePrivateHumanDm(service, {
      workspaceId,
      userId: user.id,
      peerUserId: peerUserId!,
      peerName: peer?.name ? String(peer.name) : undefined,
    });
    return NextResponse.json({ roomId: room.id, kind: "human" });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ rooms/dm]", error);
    return NextResponse.json({ error: "Unable to open direct message." }, { status: 500 });
  }
}
