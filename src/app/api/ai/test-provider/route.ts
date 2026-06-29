import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { callSiliconFlowEmployee } from "@/lib/ai/siliconflow-call";
import { callOpenAiEmployee } from "@/lib/ai/openai-call";
import {
  getOutputTokenCap,
  getTimeoutMs,
  estimateCost,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { isOpenAiConfigured, isSiliconFlowConfigured } from "@/lib/config/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TestBody = {
  workspaceId: string;
  provider?: string;
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
    const model = resolveModel(provider, modelMode);

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

    const started = Date.now();
    const result =
      provider === "siliconflow"
        ? await callSiliconFlowEmployee(system, prompt, model, maxTokens, timeoutMs)
        : provider === "openai"
          ? await callOpenAiEmployee(system, prompt, model, maxTokens, timeoutMs)
          : null;

    if (!result) {
      return NextResponse.json(
        { ok: false, error: `Provider "${provider}" is not supported for testing.` },
        { status: 400 },
      );
    }

    const latencyMs = Date.now() - started;
    const inputTokens = result.inputTokens ?? 0;
    const outputTokens = result.outputTokens ?? 0;
    const estimatedCostUsd = estimateCost(result.model, inputTokens, outputTokens);

    recordAiRuntime({
      workspaceId: body.workspaceId,
      provider,
      model: result.model,
      modelMode,
      mode: "live",
      durationMs: latencyMs,
      inputTokens,
      outputTokens,
      cachedTokens: result.cachedTokens,
      estimatedCostUsd,
      fallbackTier: result.fallbackTier,
    });

    return NextResponse.json({
      ok: true,
      provider,
      model: result.model,
      modelMode,
      latencyMs,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      reply: result.response.reply,
      structuredOutputUsed: result.structuredOutputUsed,
      fallbackTier: result.fallbackTier,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ test-provider]", error);
    const message = error instanceof Error ? error.message : "Provider test failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
