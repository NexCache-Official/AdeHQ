import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import {
  siliconFlowChatModel,
} from "@/lib/ai/siliconflow-client";
import {
  siliconFlowModelsForMode,
} from "@/lib/ai/siliconflow-call";
import {
  getOutputTokenCap,
  getTimeoutMs,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import {
  isSiliconFlowConfigured,
} from "@/lib/config/features";
import {
  callProviderHealthCheck,
  healthCheckCost,
} from "@/lib/ai/provider-health-call";
import { formatProviderError } from "@/lib/ai/provider-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TestBody = {
  workspaceId: string;
  modelMode?: ModelMode;
  prompt?: string;
};

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as TestBody;

    if (!body.workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);
    if (!["admin","owner"].includes(role)) {
      return NextResponse.json(
        { error: "Only workspace owners and admins can test AI providers." },
        { status: 403 },
      );
    }

    const provider = "siliconflow";
    const modelMode = body.modelMode ?? "cheap";
    const prompt = body.prompt?.trim() || "Reply with one short sentence.";
    const maxTokens = getOutputTokenCap(modelMode);
    const timeoutMs = getTimeoutMs(modelMode);
    const system = "You are a helpful assistant. Be concise.";
    const resolvedModel = resolveModel(provider, modelMode);

    if (!isSiliconFlowConfigured()) {
      return NextResponse.json(
        { ok: false, error: "SILICONFLOW_API_KEY is not configured on the server." },
        { status: 400 },
      );
    }

    const models = siliconFlowModelsForMode(resolvedModel, modelMode);

    const result = await callProviderHealthCheck(
      provider,
      models,
      system,
      prompt,
      maxTokens,
      timeoutMs,
      (modelId) => siliconFlowChatModel(modelId),
    );

    const inputTokens = result.inputTokens ?? 0;
    const outputTokens = result.outputTokens ?? 0;
    const estimatedCostUsd = healthCheckCost(result.model, inputTokens, outputTokens);

    recordAiRuntime({
      workspaceId: body.workspaceId,
      provider,
      model: result.model,
      modelMode,
      mode: "live",
      durationMs: result.latencyMs,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      fallbackTier: 3,
    });

    return NextResponse.json({
      ok: true,
      provider,
      model: result.model,
      modelMode,
      latencyMs: result.latencyMs,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      reply: result.reply,
      structuredOutputUsed: false,
      fallbackTier: 3,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ test-provider]", error);
    const message =
      error instanceof Error ? error.message : formatProviderError(error, "provider", "unknown");
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
