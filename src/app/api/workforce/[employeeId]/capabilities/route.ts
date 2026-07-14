import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  requireAuthUser,
  requireWorkspaceMembership,
} from "@/lib/supabase/auth-server";
import { loadIntegrationEmployee } from "@/lib/integrations/load-employee";
import {
  applyEmployeeCapabilityToggles,
  listEmployeeCapabilityToggles,
  syncEmployeeCapabilityGrants,
} from "@/lib/integrations/employee-capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CapabilityDomainSchema = z.enum([
  "crm",
  "email",
  "tasks",
  "artifact",
  "social",
  "calendar",
  "investor",
  "team",
  "drive",
]);

const PatchBodySchema = z.object({
  workspaceId: z.string().min(1),
  enabledDomains: z.array(CapabilityDomainSchema),
});

export async function GET(
  request: NextRequest,
  context: { params: { employeeId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    await requireWorkspaceMembership(client, workspaceId, user.id);
    const employee = await loadIntegrationEmployee(client, workspaceId, context.params.employeeId);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    return NextResponse.json({ capabilities: listEmployeeCapabilityToggles(employee) });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ workforce capabilities GET]", error);
    return NextResponse.json({ error: "Unable to load capabilities." }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: { employeeId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = PatchBodySchema.parse(await request.json());
    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);

    if (!["owner", "admin", "manager"].includes(role)) {
      return NextResponse.json(
        { error: "Only workspace owners, admins, or managers can update employee capabilities." },
        { status: 403 },
      );
    }

    const employee = await loadIntegrationEmployee(client, body.workspaceId, context.params.employeeId);
    if (!employee) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const updated = applyEmployeeCapabilityToggles(employee, body.enabledDomains);
    await syncEmployeeCapabilityGrants(
      client,
      body.workspaceId,
      context.params.employeeId,
      body.enabledDomains,
    );

    return NextResponse.json({
      ok: true,
      capabilities: listEmployeeCapabilityToggles(updated),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[AdeHQ workforce capabilities PATCH]", error);
    return NextResponse.json({ error: "Unable to update capabilities." }, { status: 500 });
  }
}
