import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { createDeal } from "@/lib/integrations/adapters/adehq-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  amount: z.number().optional(),
  currency: z.string().optional(),
  stageName: z.string().optional(),
  stage: z.string().optional(),
  companyName: z.string().optional(),
  contactName: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = BodySchema.parse(await request.json());
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const result = await createDeal(
      client,
      {
        client,
        workspaceId: body.workspaceId,
        employeeId: user.id,
        requestedByUserId: user.id,
      },
      {
        ...body,
        stage: body.stage ?? body.stageName,
      },
    );

    return NextResponse.json({ dealId: result.objectId, summary: result.summary });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[AdeHQ crm deal POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create deal." },
      { status: 500 },
    );
  }
}
