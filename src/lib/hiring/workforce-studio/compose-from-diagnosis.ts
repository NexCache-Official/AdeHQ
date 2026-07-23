// PR-22A — compose a draft blueprint from a BusinessOperatingDiagnosis.
// Reuses createDraftBlueprint + composeBlueprintFromTemplate; optional light
// mission polish keeps industry language without rewriting the graph.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { z } from "zod";
import { getTimeoutMs, resolveModel } from "@/lib/ai/model-catalog";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { createDraftBlueprint } from "./blueprint-service";
import { composeBlueprintFromTemplate } from "./composer";
import type { ClarificationAnswer, BusinessOperatingDiagnosis } from "./diagnosis-types";
import { buildArchitectComposePreview } from "./map-diagnosis-to-template";
import { getCompanyOperatingProfile, upsertCompanyOperatingProfile } from "./profile-service";
import { getTemplateManifest } from "./templates/registry";
import type { WorkforceBlueprintPayload, WorkforceBlueprintRecord } from "./types";
import { forecastWorkHours } from "./simulation";

const polishSchema = z.object({
  seats: z
    .array(
      z.object({
        seatId: z.string(),
        mission: z.string().max(280),
        roleTitle: z.string().max(80).optional(),
      }),
    )
    .max(12),
});

async function polishMissionsForIndustry(
  diagnosis: BusinessOperatingDiagnosis,
  payload: WorkforceBlueprintPayload,
): Promise<WorkforceBlueprintPayload> {
  if (!isSiliconFlowConfigured() || payload.seats.length === 0) return payload;
  try {
    const modelId = resolveModel("siliconflow", "balanced");
    const { object } = await generateObject({
      model: siliconFlowChatModel(modelId),
      schema: polishSchema,
      system:
        "Rewrite each seat mission so it sounds specific to this business. Keep the same job shape. No markdown. One or two sentences each.",
      prompt: [
        `Business: ${diagnosis.businessType} (${diagnosis.operatingModel})`,
        `Narrative: ${diagnosis.narrative}`,
        `Seats:\n${payload.seats.map((s) => `- ${s.id}: ${s.roleTitle} — ${s.mission}`).join("\n")}`,
      ].join("\n\n"),
      abortSignal: AbortSignal.timeout(getTimeoutMs("balanced")),
      providerOptions: siliconFlowProviderOptions(modelId),
    });
    const byId = new Map(object.seats.map((s) => [s.seatId, s]));
    return {
      ...payload,
      seats: payload.seats.map((seat) => {
        const polish = byId.get(seat.id);
        if (!polish) return seat;
        return {
          ...seat,
          mission: polish.mission.trim() || seat.mission,
          roleTitle: polish.roleTitle?.trim() || seat.roleTitle,
        };
      }),
    };
  } catch (error) {
    console.warn("[AdeHQ workforce-studio] seat polish skipped", error);
    return payload;
  }
}

export async function composeBlueprintFromDiagnosis(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    userId: string;
    diagnosis: BusinessOperatingDiagnosis;
    answers: ClarificationAnswer[];
    businessDescription: string;
    websiteUrl?: string;
    polishMissions?: boolean;
  },
): Promise<{
  blueprint: WorkforceBlueprintRecord;
  designReasons: string[];
  expectedWeeklyWhLow: number;
  expectedWeeklyWhHigh: number;
  templateKey: string;
  mappingReason: string;
}> {
  const existing = await getCompanyOperatingProfile(client, params.workspaceId);
  const profile = await upsertCompanyOperatingProfile(client, {
    workspaceId: params.workspaceId,
    updatedBy: params.userId,
    profile: {
      companyName: existing?.companyName || params.diagnosis.businessType,
      industry: params.diagnosis.industry,
      businessModel: params.diagnosis.operatingModel,
      stage: existing?.stage ?? "early_revenue",
      headcountHumans: existing?.headcountHumans ?? 1,
      primaryOutcomes: params.diagnosis.growthPriorities.map((p) => p.title).slice(0, 5),
      existingDepartments: params.diagnosis.proposedDepartments.map((d) => d.name),
      riskTolerance: existing?.riskTolerance ?? "balanced",
      complianceNotes: existing?.complianceNotes ?? "",
      workingHoursNote: existing?.workingHoursNote ?? "",
      businessDescription: params.businessDescription,
      websiteUrl: params.websiteUrl ?? existing?.websiteUrl ?? "",
      diagnosis: params.diagnosis,
    },
  });

  const preview = buildArchitectComposePreview(
    params.diagnosis,
    params.answers,
    profile.revision,
  );
  // Prefer the mapping's resolved manifest (ontology compile or legacy).
  // Ephemeral packs are not in the static registry.
  const manifest =
    preview.mapping.manifest.baseSeats.length > 0
      ? preview.mapping.manifest
      : getTemplateManifest(preview.templateKey);
  if (!manifest) throw new Error(`Unknown template "${preview.templateKey}".`);

  let payload = composeBlueprintFromTemplate(
    manifest,
    preview.intakeAnswers,
    profile.revision,
  );
  if (params.polishMissions !== false) {
    payload = await polishMissionsForIndustry(params.diagnosis, payload);
  }

  const blueprint = await createDraftBlueprint(client, {
    workspaceId: params.workspaceId,
    createdBy: params.userId,
    name: preview.teamName,
    templateKey: manifest.key,
    templateVersion: manifest.version,
    payload,
  });

  const bands = forecastWorkHours(blueprint.draftPayload.seats);
  return {
    blueprint,
    designReasons: preview.designReasons,
    expectedWeeklyWhLow: Math.round(bands.reduce((sum, b) => sum + b.lowWh, 0)),
    expectedWeeklyWhHigh: Math.round(bands.reduce((sum, b) => sum + b.highWh, 0)),
    templateKey: preview.templateKey,
    mappingReason: preview.mapping.mappingReason,
  };
}
