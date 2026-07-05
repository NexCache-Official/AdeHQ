import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { resolveModel } from "@/lib/ai/model-catalog";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { generateObject as runtimeGenerateObject, planRoute } from "@/lib/ai/runtime";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { applicantCopySchema } from "@/lib/hiring/brief-schema";
import type { ApplicantCopy } from "@/lib/hiring/candidate-engine";
import {
  completeAiWorkUnit,
  createAiWorkUnit,
  failAiWorkUnit,
  startAiWorkUnit,
} from "@/lib/supabase/ai-work-units";
import type { AiEmployeeJobBrief, CandidateTier } from "@/lib/hiring/types";

const copyOnlySchema = z.object({
  copies: applicantCopySchema,
});

export type CandidateCopiesResult = Partial<Record<CandidateTier, ApplicantCopy>>;

export type CandidatesLlmOptions = {
  client?: SupabaseClient;
  workspaceId?: string;
  userId?: string;
  hiringSessionId?: string;
  roleKey?: string | null;
  departmentId?: string | null;
};

export type CandidatesRuntimeDispatch = "old" | "shadow" | "runtime-on";

export type CandidatesTestHooks = {
  forceRuntimeFailure?: boolean | Error;
  stubOldResult?: CandidateCopiesResult;
  onRuntimeFallback?: (info: { error: string; workUnitFailed: boolean }) => void;
};

let candidatesTestHooks: CandidatesTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setCandidatesTestHooks(hooks: CandidatesTestHooks | null): void {
  candidatesTestHooks = hooks;
}

export function getCandidatesRuntimeDispatch(): CandidatesRuntimeDispatch {
  const { mode } = getRuntimeFlags();
  if (mode === "on") return "runtime-on";
  if (mode === "shadow") return "shadow";
  return "old";
}

/** Direct SiliconFlow path — unchanged from pre-Runtime V2 behavior. */
export async function generateCandidateCopiesOld(
  brief: AiEmployeeJobBrief,
): Promise<CandidateCopiesResult | undefined> {
  if (candidatesTestHooks?.stubOldResult) {
    return candidatesTestHooks.stubOldResult;
  }

  if (!isSiliconFlowConfigured()) {
    return undefined;
  }

  const modelId = resolveModel("siliconflow", "cheap");
  const { object } = await generateObject({
    model: siliconFlowChatModel(modelId),
    schema: copyOnlySchema,
    system: `Generate ONLY applicant copy (names, titles, personality tags, strengths, watch-outs, bestFor, whyThisCandidate, candidatePitch, howIWork).
Do NOT change model modes, hours, quality, speed, or cost — those are set by the system.
Create 3 distinct personas for tiers: high_capacity (fast/cheap), recommended (balanced), premium (senior/deep).
Match the job brief domain and role.
Keep copy scannable: candidatePitch max 18 words; bestFor one short sentence; strengths max 3 items; watchOuts max 2; howIWork max 3 short bullets; whyThisCandidate max 14 words.`,
    prompt: JSON.stringify(brief),
    maxOutputTokens: 1500,
    providerOptions: siliconFlowProviderOptions(modelId),
  });

  return object.copies as CandidateCopiesResult;
}

async function recordCandidatesShadowPlanning(
  brief: AiEmployeeJobBrief,
  options: CandidatesLlmOptions,
): Promise<void> {
  try {
    const routing = planRoute(
      {
        capability: "structured_chat",
        message: JSON.stringify(brief).slice(0, 500),
        workspaceId: options.workspaceId,
      },
      { forceMode: "shadow" },
    );

    recordAiRuntime({
      provider: routing.providerName,
      model: routing.modelId,
      mode: "fallback",
      fallbackReason: "hiring_candidates_shadow_plan",
      workspaceId: options.workspaceId,
      estimatedCostUsd: routing.estimatedCostUsd,
    });

    if (options.client && options.workspaceId) {
      await createAiWorkUnit(options.client, {
        workspaceId: options.workspaceId,
        userId: options.userId,
        workType: "hiring_candidates",
        capability: "structured_chat",
        objective: "Shadow plan for hiring candidates",
        status: "planned",
        runtimeMode: routing.runtimeMode,
        providerRoute: routing.providerRoute,
        providerName: routing.providerName,
        modelId: routing.modelId,
        estimatedCostUsd: routing.estimatedCostUsd,
        estimatedWorkMinutes: routing.estimatedWorkMinutes,
        metadata: {
          shadow: true,
          source: "hiring_candidates",
          roleTitle: brief.roleTitle,
          roleKey: options.roleKey,
          hiringSessionId: options.hiringSessionId,
          userId: options.userId,
        },
      });
    }
  } catch (error) {
    console.warn("[AdeHQ hiring candidates shadow]", error);
  }
}

/** Runtime V2 path — used when AI_RUNTIME_V2_MODE=on. */
export async function generateCandidateCopiesRuntime(
  brief: AiEmployeeJobBrief,
  options: CandidatesLlmOptions = {},
): Promise<CandidateCopiesResult> {
  if (candidatesTestHooks?.forceRuntimeFailure) {
    throw candidatesTestHooks.forceRuntimeFailure instanceof Error
      ? candidatesTestHooks.forceRuntimeFailure
      : new Error("Forced hiring candidates runtime failure (test hook)");
  }

  let workUnitId: string | undefined;
  const systemPrompt = `Generate ONLY applicant copy (names, titles, personality tags, strengths, watch-outs, bestFor, whyThisCandidate, candidatePitch, howIWork).
Do NOT change model modes, hours, quality, speed, or cost — those are set by the system.
Create 3 distinct personas for tiers: high_capacity (fast/cheap), recommended (balanced), premium (senior/deep).
Match the job brief domain and role.
Keep copy scannable: candidatePitch max 18 words; bestFor one short sentence; strengths max 3 items; watchOuts max 2; howIWork max 3 short bullets; whyThisCandidate max 14 words.`;

  if (options.client && options.workspaceId) {
    try {
      const created = await createAiWorkUnit(options.client, {
        workspaceId: options.workspaceId,
        userId: options.userId,
        workType: "hiring_candidates",
        capability: "structured_chat",
        objective: "Generate hiring candidate copy",
        runtimeMode: "efficient",
        metadata: {
          source: "hiring_candidates",
          roleTitle: brief.roleTitle,
          roleKey: options.roleKey,
          hiringSessionId: options.hiringSessionId,
          userId: options.userId,
          workspaceId: options.workspaceId,
        },
      });
      workUnitId = created.id;
      await startAiWorkUnit(options.client, options.workspaceId, workUnitId, {
        runtimeMode: "efficient",
        reasoningProfile: "low",
      });
    } catch (error) {
      console.warn("[AdeHQ hiring candidates work unit]", error);
    }
  }

  const result = await runtimeGenerateObject(
    {
      workspaceId: options.workspaceId,
      workUnitId,
      capability: "structured_chat",
      runtimeMode: "efficient",
      reasoningProfile: "low",
      schema: copyOnlySchema,
      system: systemPrompt,
      prompt: JSON.stringify(brief),
      maxTokens: 1500,
      preferJsonMode: true,
      metadata: {
        source: "hiring_candidates",
        roleTitle: brief.roleTitle,
        roleKey: options.roleKey,
        hiringSessionId: options.hiringSessionId,
        userId: options.userId,
        workspaceId: options.workspaceId,
      },
    },
    { forceMode: "on" },
  );

  const parsed = copyOnlySchema.safeParse(result.object);
  if (!parsed.success) {
    throw new Error("Runtime hiring candidates output failed schema validation.");
  }

  if (options.client && options.workspaceId && workUnitId) {
    try {
      await completeAiWorkUnit(options.client, options.workspaceId, workUnitId, {
        actualCostUsd: result.usage.totalCostUsd,
        actualWorkMinutes: result.workMinutesEstimated,
        metadata: {
          providerRoute: result.usage.providerRoute,
          modelId: result.usage.modelId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      });
    } catch (error) {
      console.warn("[AdeHQ hiring candidates work unit complete]", error);
    }
  }

  recordAiRuntime({
    provider: result.usage.providerName,
    model: result.usage.modelId,
    mode: "live",
    workspaceId: options.workspaceId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedCostUsd: result.usage.totalCostUsd,
    durationMs: result.usage.latencyMs,
    agentRunId: workUnitId,
  });

  return parsed.data.copies as CandidateCopiesResult;
}

/**
 * Generate candidate copy via LLM.
 * Dispatches by AI_RUNTIME_V2_MODE: off → old, shadow → old + shadow plan, on → runtime with fallback.
 */
export async function generateCandidateCopies(
  brief: AiEmployeeJobBrief,
  options: CandidatesLlmOptions = {},
): Promise<CandidateCopiesResult | undefined> {
  const dispatch = getCandidatesRuntimeDispatch();

  if (dispatch === "runtime-on") {
    try {
      return await generateCandidateCopiesRuntime(brief, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAiRuntime({
        provider: "siliconflow",
        model: resolveModel("siliconflow", "cheap"),
        mode: "fallback",
        fallbackReason: "hiring_candidates_runtime_failed",
        workspaceId: options.workspaceId,
        error: message,
      });

      let workUnitFailed = false;
      if (options.client && options.workspaceId) {
        try {
          const failed = await createAiWorkUnit(options.client, {
            workspaceId: options.workspaceId,
            userId: options.userId,
            workType: "hiring_candidates",
            capability: "structured_chat",
            objective: "Runtime hiring candidates failed — fell back to legacy path",
            status: "failed",
            metadata: { fallback: true, error: message, source: "hiring_candidates" },
          });
          await failAiWorkUnit(options.client, options.workspaceId, failed.id, message);
          workUnitFailed = true;
        } catch {
          // debug only
        }
      }

      candidatesTestHooks?.onRuntimeFallback?.({ error: message, workUnitFailed });

      return generateCandidateCopiesOld(brief);
    }
  }

  if (dispatch === "shadow") {
    void recordCandidatesShadowPlanning(brief, options);
    return generateCandidateCopiesOld(brief);
  }

  return generateCandidateCopiesOld(brief);
}
