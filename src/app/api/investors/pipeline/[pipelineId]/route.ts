import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { updateInvestorPipelineRecord } from "@/lib/server/investor-mutations";
import type { InvestorStage } from "@/lib/investors/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  workspaceId: z.string().min(1),
  stage: z
    .enum(["target", "researched", "drafted", "contacted", "replied", "meeting", "passed", "committed"])
    .optional(),
  fitScore: z.number().nullable().optional(),
  targetAmount: z.number().nullable().optional(),
  currency: z.string().optional(),
  notes: z.string().nullable().optional(),
  nextFollowUpAt: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { pipelineId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = PatchSchema.parse(await request.json());
    await requireWorkspaceMembership(client, body.workspaceId, user.id);

    const record = await updateInvestorPipelineRecord(client, body.workspaceId, params.pipelineId, {
      stage: body.stage as InvestorStage | undefined,
      fitScore: body.fitScore,
      targetAmount: body.targetAmount,
      currency: body.currency,
      notes: body.notes,
      nextFollowUpAt: body.nextFollowUpAt,
    });
    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[AdeHQ investor pipeline PATCH]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update pipeline record." },
      { status: 500 },
    );
  }
}
