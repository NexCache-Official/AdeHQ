import { NextRequest, NextResponse } from "next/server";
import { openai } from "@ai-sdk/openai";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import {
  siliconFlowChatModel,
  siliconFlowProviderOptions,
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
  isOpenAiConfigured,
  isSiliconFlowConfigured,
  DEFAULT_OPENAI_MODEL,
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
  provider?: string;
  modelMode?: ModelMode;
  prompt?: string;
};

const OPENAI_HEALTH_FALLBACKS = [DEFAULT_OPENAI_MODEL, "gpt-4o-mini"] as const;

export async function POST(request: NextRequest) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as TestBody;

    if (!body.workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const { role } = await requireWorkspaceMembership(client, body.workspaceId, user.id);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json(
        { error: "Only workspace owners and admins can test AI providers." },
        { status: 403 },
      );
    }

    const provider = (body.provider ?? "siliconflow").toLowerCase();
    const modelMode = body.modelMode ?? "cheap";
    const prompt = body.prompt?.trim() || "Reply with one short sentence.";
    const maxTokens = getOutputTokenCap(modelMode);
    const timeoutMs = getTimeoutMs(modelMode);
    const system = "You are a helpful assistant. Be concise.";
    const resolvedModel = resolveModel(provider, modelMode);

    if (provider === "siliconflow" && !isSiliconFlowConfigured()) {
      return NextResponse.json(
        { ok: false, error: "SILICONFLOW_API_KEY is not configured on the server." },
        { status: 400 },
      );
    }

    if (provider === "openai" && !isOpenAiConfigured()) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY is not configured on the server." },
        { status: 400 },
      );
    }

    if (provider !== "siliconflow" && provider !== "openai") {
      return NextResponse.json(
        { ok: false, error: `Provider "${provider}" is not supported for testing.` },
        { status: 400 },
      );
    }

    const models =
      provider === "siliconflow"
        ? siliconFlowModelsForMode(resolvedModel, modelMode)
        : [...new Set([resolvedModel, ...OPENAI_HEALTH_FALLBACKS])];

    const result = await callProviderHealthCheck(
      provider,
      models,
      system,
      prompt,
      maxTokens,
      timeoutMs,
      (modelId) =>
        provider === "siliconflow"
          ? siliconFlowChatModel(modelId)
          : openai.chat(modelId),
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
