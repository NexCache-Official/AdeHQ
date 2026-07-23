import { NextRequest, NextResponse } from "next/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { listTemplateManifestsWithCategory } from "@/lib/hiring/workforce-studio/templates/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    await requireWorkforceStudioAdmin(request, workspaceId);

    const templates = listTemplateManifestsWithCategory().map((t) => ({
      key: t.key,
      version: t.version,
      name: t.name,
      description: t.description,
      industry: t.industry,
      category: t.category,
      intakeQuestions: t.intakeQuestions,
      baseSeatCount: t.baseSeats.length,
      scalingRuleCount: t.scalingRules.length,
    }));

    return NextResponse.json({ templates });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/templates");
  }
}
