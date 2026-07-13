/**
 * GET /api/inbox/mailbox/members?workspaceId= — humans who can be assigned.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveInboxRoute(
      request,
      request.nextUrl.searchParams.get("workspaceId") ?? undefined,
      "organize",
    );

    const { data: members, error } = await ctx.secret
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", ctx.workspaceId)
      .eq("status", "active")
      .in("role", ["owner", "admin", "manager", "member"]);
    if (error) throw error;

    const userIds = (members ?? []).map((m) => String(m.user_id));
    const nameById = new Map<string, { name: string; email: string | null }>();
    if (userIds.length > 0) {
      const { data: profiles } = await ctx.secret
        .from("profiles")
        .select("id, name, email")
        .in("id", userIds);
      for (const p of profiles ?? []) {
        nameById.set(String(p.id), {
          name: String(p.name ?? "").trim() || String(p.email ?? "Member"),
          email: (p.email as string) ?? null,
        });
      }
    }

    return NextResponse.json({
      members: (members ?? []).map((m) => {
        const id = String(m.user_id);
        const profile = nameById.get(id);
        return {
          id,
          role: String(m.role),
          name: profile?.name ?? "Member",
          email: profile?.email ?? null,
        };
      }),
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
