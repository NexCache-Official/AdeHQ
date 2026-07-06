import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { resolveModel } from "@/lib/ai/model-catalog";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { generateObject as runtimeGenerateObject, planRoute } from "@/lib/ai/runtime";
import { siliconFlowChatModel, siliconFlowProviderOptions } from "@/lib/ai/siliconflow-client";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import { recruiterResponseSchema } from "@/lib/hiring/brief-schema";
import {
  completeAiWorkUnit,
  createAiWorkUnit,
  failAiWorkUnit,
  startAiWorkUnit,
} from "@/lib/supabase/ai-work-units";
import type { RecruiterMessage } from "@/lib/hiring/types";

export type RecruiterLlmBody = {
  roleSeed: string;
  selectedDepartment?: string | null;
  departmentId?: string | null;
  roleKey?: string | null;
  mode?: string;
  refineInstruction?: string;
  refineMode?: string;
  refineSection?: string;
};

export type RecruiterLlmParams = {
  body: RecruiterLlmBody;
  conversation: RecruiterMessage[];
  system: string;
  prompt: string;
};

export type RecruiterLlmOptions = {
  client?: SupabaseClient;
  workspaceId?: string;
  userId?: string;
  hiringSessionId?: string;
};

export type RecruiterLlmResult = z.infer<typeof recruiterResponseSchema>;

export type RecruiterRuntimeDispatch = "old" | "shadow" | "runtime-on";

export type RecruiterTestHooks = {
  forceRuntimeFailure?: boolean | Error;
  stubOldResult?: RecruiterLlmResult;
  onRuntimeFallback?: (info: { error: string; workUnitFailed: boolean }) => void;
};

let recruiterTestHooks: RecruiterTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setRecruiterTestHooks(hooks: RecruiterTestHooks | null): void {
  recruiterTestHooks = hooks;
}

export function getRecruiterRuntimeDispatch(): RecruiterRuntimeDispatch {
  const { mode } = getRuntimeFlags();
  if (mode === "on") return "runtime-on";
  if (mode === "shadow") return "shadow";
  return "old";
}

/** Direct SiliconFlow path — unchanged from pre-Runtime V2 behavior. */
export async function generateRecruiterResponseOld(
  params: RecruiterLlmParams,
): Promise<RecruiterLlmResult> {
  if (recruiterTestHooks?.stubOldResult) {
    return recruiterTestHooks.stubOldResult;
  }

  if (!isSiliconFlowConfigured()) {
    throw new Error("SILICONFLOW_API_KEY is not configured.");
  }

  const modelId = resolveModel("siliconflow", "cheap");
  const { object } = await generateObject({
    model: siliconFlowChatModel(modelId),
    schema: recruiterResponseSchema,
    system: params.system,
    prompt: params.prompt,
    maxOutputTokens: 950,
    providerOptions: siliconFlowProviderOptions(modelId),
  });

  return object;
}

async function recordRecruiterShadowPlanning(
  params: RecruiterLlmParams,
  options: RecruiterLlmOptions,
): Promise<void> {
  try {
    const routing = planRoute(
      {
        capability: "structured_chat",
        message: params.prompt.slice(0, 500),
        workspaceId: options.workspaceId,
      },
      { forceMode: "shadow" },
    );

    recordAiRuntime({
      provider: routing.providerName,
      model: routing.modelId,
      mode: "fallback",
      fallbackReason: "hiring_recruiter_shadow_plan",
      workspaceId: options.workspaceId,
      estimatedCostUsd: routing.estimatedCostUsd,
    });

    if (options.client && options.workspaceId) {
      await createAiWorkUnit(options.client, {
        workspaceId: options.workspaceId,
        userId: options.userId,
        workType: "hiring_recruiter",
        capability: "structured_chat",
        objective: "Shadow plan for hiring recruiter",
        status: "planned",
        runtimeMode: routing.runtimeMode,
        providerRoute: routing.providerRoute,
        providerName: routing.providerName,
        modelId: routing.modelId,
        estimatedCostUsd: routing.estimatedCostUsd,
        estimatedWorkMinutes: routing.estimatedWorkMinutes,
        metadata: {
          shadow: true,
          source: "hiring_recruiter",
          roleTitle: params.body.roleSeed,
          roleKey: params.body.roleKey,
          hiringSessionId: options.hiringSessionId,
          userId: options.userId,
        },
      });
    }
  } catch (error) {
    console.warn("[AdeHQ hiring recruiter shadow]", error);
  }
}

/** Runtime V2 path — used when AI_RUNTIME_V2_MODE=on. */
export async function generateRecruiterResponseRuntime(
  params: RecruiterLlmParams,
  options: RecruiterLlmOptions = {},
): Promise<RecruiterLlmResult> {
  if (recruiterTestHooks?.forceRuntimeFailure) {
    throw recruiterTestHooks.forceRuntimeFailure instanceof Error
      ? recruiterTestHooks.forceRuntimeFailure
      : new Error("Forced hiring recruiter runtime failure (test hook)");
  }

  let workUnitId: string | undefined;

  if (options.client && options.workspaceId) {
    try {
      const created = await createAiWorkUnit(options.client, {
        workspaceId: options.workspaceId,
        userId: options.userId,
        workType: "hiring_recruiter",
        capability: "structured_chat",
        objective: "Generate hiring recruiter response",
        runtimeMode: "efficient",
        metadata: {
          source: "hiring_recruiter",
          roleTitle: params.body.roleSeed,
          roleKey: params.body.roleKey,
          hiringSessionId: options.hiringSessionId,
          userId: options.userId,
          workspaceId: options.workspaceId,
        },
      });
      workUnitId = created.id;
      await startAiWorkUnit(options.client, options.workspaceId, workUnitId, {
        runtimeMode: "efficient",
        reasoningProfile: "none",
      });
    } catch (error) {
      console.warn("[AdeHQ hiring recruiter work unit]", error);
    }
  }

  const result = await runtimeGenerateObject(
    {
      workspaceId: options.workspaceId,
      workUnitId,
      capability: "structured_chat",
      runtimeMode: "efficient",
      modelMode: "cheap",
      reasoningProfile: "none",
      schema: recruiterResponseSchema,
      system: params.system,
      prompt: params.prompt,
      maxTokens: 950,
      preferJsonMode: true,
      metadata: {
        source: "hiring_recruiter",
        roleTitle: params.body.roleSeed,
        roleKey: params.body.roleKey,
        hiringSessionId: options.hiringSessionId,
        userId: options.userId,
        workspaceId: options.workspaceId,
      },
    },
    { forceMode: "on" },
  );

  const parsed = recruiterResponseSchema.safeParse(result.object);
  if (!parsed.success) {
    throw new Error("Runtime hiring recruiter output failed schema validation.");
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
      console.warn("[AdeHQ hiring recruiter work unit complete]", error);
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

  return parsed.data;
}

/**
 * Generate recruiter LLM response.
 * Dispatches by AI_RUNTIME_V2_MODE: off → old, shadow → old + shadow plan, on → runtime with fallback.
 */
export async function generateRecruiterResponse(
  params: RecruiterLlmParams,
  options: RecruiterLlmOptions = {},
): Promise<RecruiterLlmResult> {
  const dispatch = getRecruiterRuntimeDispatch();

  if (dispatch === "runtime-on") {
    try {
      return await generateRecruiterResponseRuntime(params, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAiRuntime({
        provider: "siliconflow",
          model: resolveModel("siliconflow", "balanced"),
        mode: "fallback",
        fallbackReason: "hiring_recruiter_runtime_failed",
        workspaceId: options.workspaceId,
        error: message,
      });

      let workUnitFailed = false;
      if (options.client && options.workspaceId) {
        try {
          const failed = await createAiWorkUnit(options.client, {
            workspaceId: options.workspaceId,
            userId: options.userId,
            workType: "hiring_recruiter",
            capability: "structured_chat",
            objective: "Runtime hiring recruiter failed — fell back to legacy path",
            status: "failed",
            metadata: { fallback: true, error: message, source: "hiring_recruiter" },
          });
          await failAiWorkUnit(options.client, options.workspaceId, failed.id, message);
          workUnitFailed = true;
        } catch {
          // debug only
        }
      }

      recruiterTestHooks?.onRuntimeFallback?.({ error: message, workUnitFailed });

      return generateRecruiterResponseOld(params);
    }
  }

  if (dispatch === "shadow") {
    void recordRecruiterShadowPlanning(params, options);
    return generateRecruiterResponseOld(params);
  }

  return generateRecruiterResponseOld(params);
}
