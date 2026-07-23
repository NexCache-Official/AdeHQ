import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { composeBlueprintFromDiagnosis } from "@/lib/hiring/workforce-studio/compose-from-diagnosis";
import { acquireBlueprintLock } from "@/lib/hiring/workforce-studio/blueprint-service";
import type {
  BusinessOperatingDiagnosis,
  ClarificationAnswer,
} from "@/lib/hiring/workforce-studio/diagnosis-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Body = {
  workspaceId?: string;
  diagnosis?: BusinessOperatingDiagnosis;
  answers?: ClarificationAnswer[];
  businessDescription?: string;
  websiteUrl?: string;
  polishMissions?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const { user, workspaceId } = await requireWorkforceStudioAdmin(
      request,
      getRequestWorkspaceId(request) ?? body.workspaceId,
    );
    if (!body.diagnosis) {
      return NextResponse.json({ error: "diagnosis is required." }, { status: 400 });
    }
    const description = body.businessDescription?.trim() || body.diagnosis.narrative;
    const service = createSupabaseSecretClient();
    const composed = await composeBlueprintFromDiagnosis(service, {
      workspaceId,
      userId: user.id,
      diagnosis: body.diagnosis,
      answers: body.answers ?? [],
      businessDescription: description,
      websiteUrl: body.websiteUrl,
      polishMissions: body.polishMissions,
    });

    const lock = await acquireBlueprintLock(
      service,
      workspaceId,
      composed.blueprint.id,
      user.id,
    );

    return NextResponse.json({
      blueprint: composed.blueprint,
      lockToken: lock.lockToken,
      lockExpiresAt: lock.lockExpiresAt,
      designReasons: composed.designReasons,
      expectedWeeklyWhLow: composed.expectedWeeklyWhLow,
      expectedWeeklyWhHigh: composed.expectedWeeklyWhHigh,
      templateKey: composed.templateKey,
      mappingReason: composed.mappingReason,
    });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/architect/compose");
  }
}
