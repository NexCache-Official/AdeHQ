import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { updateCrmDeal } from "@/lib/server/crm-mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).optional(),
  amount: z.number().nullable().optional(),
  currency: z.string().optional(),
  stageName: z.string().optional(),
  status: z.enum(["open", "won", "lost"]).optional(),
  expectedCloseDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { dealId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = PatchSchema.parse(await request.json());
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const deal = await updateCrmDeal(client, body.workspaceId, params.dealId, body);
    return NextResponse.json({ deal });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[AdeHQ crm deal PATCH]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update deal." },
      { status: 500 },
    );
  }
}
