import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import {
  diagnoseBusiness,
  fetchWebsiteSnippet,
} from "@/lib/hiring/workforce-studio/diagnose-business";
import { upsertCompanyOperatingProfile, getCompanyOperatingProfile } from "@/lib/hiring/workforce-studio/profile-service";
import { EMPTY_COMPANY_PROFILE } from "@/lib/hiring/workforce-studio/company-profile-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Body = {
  workspaceId?: string;
  description?: string;
  websiteUrl?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const { user, workspaceId } = await requireWorkforceStudioAdmin(
      request,
      getRequestWorkspaceId(request) ?? body.workspaceId,
    );
    const description = body.description?.trim() ?? "";
    if (description.length < 20) {
      return NextResponse.json(
        { error: "Tell Maya a bit more about the business (at least a sentence or two)." },
        { status: 400 },
      );
    }

    const websiteUrl = body.websiteUrl?.trim() ?? "";
    const websiteSnippet = websiteUrl ? await fetchWebsiteSnippet(websiteUrl) : null;
    const diagnosis = await diagnoseBusiness({ description, websiteSnippet });

    const service = createSupabaseSecretClient();
    const existing = await getCompanyOperatingProfile(service, workspaceId);
    const profile = await upsertCompanyOperatingProfile(service, {
      workspaceId,
      updatedBy: user.id,
      profile: {
        ...(existing
          ? {
              companyName: existing.companyName || diagnosis.businessType,
              industry: diagnosis.industry,
              businessModel: diagnosis.operatingModel,
              stage: existing.stage,
              headcountHumans: existing.headcountHumans,
              primaryOutcomes: diagnosis.growthPriorities.map((p) => p.title).slice(0, 5),
              existingDepartments: diagnosis.proposedDepartments.map((d) => d.name),
              riskTolerance: existing.riskTolerance,
              complianceNotes: existing.complianceNotes,
              workingHoursNote: existing.workingHoursNote,
            }
          : {
              ...EMPTY_COMPANY_PROFILE,
              companyName: diagnosis.businessType,
              industry: diagnosis.industry,
              businessModel: diagnosis.operatingModel,
              primaryOutcomes: diagnosis.growthPriorities.map((p) => p.title).slice(0, 5),
              existingDepartments: diagnosis.proposedDepartments.map((d) => d.name),
            }),
        businessDescription: description,
        websiteUrl,
        diagnosis,
      },
    });

    return NextResponse.json({ diagnosis, profile });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/architect/diagnose");
  }
}
