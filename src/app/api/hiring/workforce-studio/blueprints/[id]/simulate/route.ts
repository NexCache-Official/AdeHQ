import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { getBlueprint, saveSimulationReport, logEvent } from "@/lib/hiring/workforce-studio/blueprint-service";
import { runSimulation } from "@/lib/hiring/workforce-studio/simulation";
import { narrateSimulation } from "@/lib/hiring/workforce-studio/narration";
import { getTemplateManifest } from "@/lib/hiring/workforce-studio/templates/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type SimulateBody = { workspaceId?: string; expectedRevision?: number };

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json()) as SimulateBody;
    const { user, workspaceId } = await requireWorkforceStudioAdmin(
      request,
      getRequestWorkspaceId(request) ?? body.workspaceId,
    );

    const service = createSupabaseSecretClient();
    const blueprint = await getBlueprint(service, workspaceId, params.id);
    if (typeof body.expectedRevision === "number" && body.expectedRevision !== blueprint.revision) {
      return NextResponse.json(
        { error: "Blueprint changed since you last loaded it.", code: "revision_conflict", currentRevision: blueprint.revision },
        { status: 409 },
      );
    }

    const manifest = getTemplateManifest(blueprint.draftPayload.templateKey);
    const report = runSimulation(blueprint.draftPayload, manifest?.scenarios ?? [], blueprint.revision);
    report.narration = await narrateSimulation(report);

    await saveSimulationReport(service, {
      workspaceId,
      blueprintId: params.id,
      revision: blueprint.revision,
      report,
    });

    await logEvent(service, {
      workspaceId,
      blueprintId: params.id,
      eventType: "blueprint_simulated",
      payload: { passed: report.passed, findingCount: report.findings.length },
      createdBy: user.id,
    });

    return NextResponse.json({ report });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]/simulate");
  }
}
