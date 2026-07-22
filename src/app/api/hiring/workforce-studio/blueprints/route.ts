import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { createDraftBlueprint, listBlueprints } from "@/lib/hiring/workforce-studio/blueprint-service";
import { composeBlueprintFromTemplate } from "@/lib/hiring/workforce-studio/composer";
import { getTemplateManifest } from "@/lib/hiring/workforce-studio/templates/registry";
import { getCompanyOperatingProfile } from "@/lib/hiring/workforce-studio/profile-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    const { workspaceId: wsId } = await requireWorkforceStudioAdmin(request, workspaceId);
    const service = createSupabaseSecretClient();
    const blueprints = await listBlueprints(service, wsId);
    return NextResponse.json({ blueprints });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints");
  }
}

type CreateBody = {
  workspaceId?: string;
  templateKey?: string;
  name?: string;
  intakeAnswers?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateBody;
    const { user, workspaceId } = await requireWorkforceStudioAdmin(request, getRequestWorkspaceId(request) ?? body.workspaceId);

    const manifest = getTemplateManifest(body.templateKey ?? "");
    if (!manifest) {
      return NextResponse.json({ error: `Unknown template "${body.templateKey}".` }, { status: 400 });
    }

    const service = createSupabaseSecretClient();
    const profile = await getCompanyOperatingProfile(service, workspaceId);

    const payload = composeBlueprintFromTemplate(
      manifest,
      body.intakeAnswers ?? {},
      profile?.revision ?? null,
    );

    const blueprint = await createDraftBlueprint(service, {
      workspaceId,
      createdBy: user.id,
      name: body.name?.trim() || `${manifest.name} team`,
      templateKey: manifest.key,
      templateVersion: manifest.version,
      payload,
    });

    return NextResponse.json({ blueprint });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints");
  }
}
