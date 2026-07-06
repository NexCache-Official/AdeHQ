import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { updateCrmCompany } from "@/lib/server/crm-mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).optional(),
  domain: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { companyId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = PatchSchema.parse(await request.json());
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const company = await updateCrmCompany(client, body.workspaceId, params.companyId, body);
    return NextResponse.json({ company });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[AdeHQ crm company PATCH]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update company." },
      { status: 500 },
    );
  }
}
