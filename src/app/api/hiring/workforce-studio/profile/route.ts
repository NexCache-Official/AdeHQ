import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { getCompanyOperatingProfile, upsertCompanyOperatingProfile } from "@/lib/hiring/workforce-studio/profile-service";
import { EMPTY_COMPANY_PROFILE } from "@/lib/hiring/workforce-studio/company-profile-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const { workspaceId: wsId } = await requireWorkforceStudioAdmin(request, workspaceId);
    const service = createSupabaseSecretClient();
    const profile = await getCompanyOperatingProfile(service, wsId);
    return NextResponse.json({
      profile: profile ?? { workspaceId: wsId, updatedBy: null, updatedAt: null, ...EMPTY_COMPANY_PROFILE },
    });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/profile");
  }
}

type PutBody = {
  workspaceId?: string;
  companyName?: string;
  industry?: string;
  businessModel?: string;
  stage?: string;
  headcountHumans?: number;
  primaryOutcomes?: string[];
  existingDepartments?: string[];
  riskTolerance?: string;
  complianceNotes?: string;
  workingHoursNote?: string;
};

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as PutBody;
    const { user, workspaceId } = await requireWorkforceStudioAdmin(request, getRequestWorkspaceId(request) ?? body.workspaceId);
    const service = createSupabaseSecretClient();

    const profile = await upsertCompanyOperatingProfile(service, {
      workspaceId,
      updatedBy: user.id,
      profile: {
        companyName: body.companyName?.trim() ?? "",
        industry: body.industry?.trim() ?? "",
        businessModel: body.businessModel?.trim() ?? "",
        stage: (body.stage as CompanyStage) ?? "early_revenue",
        headcountHumans: Number.isFinite(body.headcountHumans) ? Number(body.headcountHumans) : 1,
        primaryOutcomes: Array.isArray(body.primaryOutcomes) ? body.primaryOutcomes.filter(Boolean) : [],
        existingDepartments: Array.isArray(body.existingDepartments) ? body.existingDepartments.filter(Boolean) : [],
        riskTolerance: (body.riskTolerance as RiskTolerance) ?? "balanced",
        complianceNotes: body.complianceNotes?.trim() ?? "",
        workingHoursNote: body.workingHoursNote?.trim() ?? "",
      },
    });

    return NextResponse.json({ profile });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/profile");
  }
}

type CompanyStage = "idea" | "pre_launch" | "early_revenue" | "growth" | "scale";
type RiskTolerance = "conservative" | "balanced" | "aggressive";
