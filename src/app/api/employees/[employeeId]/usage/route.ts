import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { summarizeEmployeeUsage } from "@/lib/billing/usage/employee-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Customer-facing employee Work Hours: this period + since hire. */
export async function GET(
  request: NextRequest,
  { params }: { params: { employeeId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);
    const service = createSupabaseSecretClient();
    const summary = await summarizeEmployeeUsage(service, workspaceId, params.employeeId);
    if (!summary) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ employee usage GET]", error);
    return NextResponse.json({ error: "Unable to load employee usage." }, { status: 500 });
  }
}
