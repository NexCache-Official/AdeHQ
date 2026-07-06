import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { updateCrmContact } from "@/lib/server/crm-mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  workspaceId: z.string().min(1),
  firstName: z.string().min(1).optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { contactId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = PatchSchema.parse(await request.json());
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const contact = await updateCrmContact(
      client,
      body.workspaceId,
      params.contactId,
      body,
      user.id,
    );

    return NextResponse.json({ contact });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[AdeHQ crm contact PATCH]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update contact." },
      { status: 500 },
    );
  }
}
