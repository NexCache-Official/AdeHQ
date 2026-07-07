import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { resolveModel } from "@/lib/ai/model-catalog";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { embed as runtimeEmbed, planRoute } from "@/lib/ai/runtime";
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  isSiliconFlowConfigured,
  SILICONFLOW_API_BASE_URL,
} from "@/lib/config/features";
import {
  completeAiWorkUnit,
  createAiWorkUnit,
  failAiWorkUnit,
  startAiWorkUnit,
} from "@/lib/supabase/ai-work-units";

const MAX_EMBED_INPUT_CHARS = 4000;
export const EMBED_BATCH_SIZE = 16;

export type EmbedTextsOptions = {
  client?: SupabaseClient;
  workspaceId?: string;
  roomId?: string;
  topicId?: string;
  fileId?: string;
  workType?: "file_embedding" | "query_embedding";
  source?: string;
};

export type EmbedRuntimeDispatch = "old" | "shadow" | "runtime-on";

export type EmbeddingTestHooks = {
  forceRuntimeFailure?: boolean | Error;
  onRuntimeFallback?: (info: { error: string; workUnitFailed: boolean }) => void;
};

let embeddingTestHooks: EmbeddingTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setEmbeddingTestHooks(hooks: EmbeddingTestHooks | null): void {
  embeddingTestHooks = hooks;
}

function truncateForEmbedding(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EMBED_INPUT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_EMBED_INPUT_CHARS).trim()}…`;
}

function validateEmbeddings(inputs: string[], embeddings: number[][]): number[][] {
  if (embeddings.length !== inputs.length) {
    throw new Error("Embedding response count mismatch.");
  }

  for (const vec of embeddings) {
    if (vec.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Unexpected embedding dimension: ${vec.length} (expected ${EMBEDDING_DIMENSIONS}).`);
    }
  }

  return embeddings;
}

export function getEmbedRuntimeDispatch(): EmbedRuntimeDispatch {
  const { mode } = getRuntimeFlags();
  if (mode === "on") return "runtime-on";
  if (mode === "shadow") return "shadow";
  return "old";
}

export function isFileEmbeddingAvailable(): boolean {
  return isSiliconFlowConfigured() || getEmbedRuntimeDispatch() !== "old";
}

/** Direct SiliconFlow HTTP path — unchanged from pre-Runtime V2 behavior. */
export async function embedTextsOld(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.SILICONFLOW_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY is not configured.");
  }

  const inputs = texts.map(truncateForEmbedding).filter(Boolean);
  if (!inputs.length) return [];

  const response = await fetch(`${SILICONFLOW_API_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_EMBEDDING_MODEL,
      input: inputs,
      encoding_format: "float",
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Embedding request failed (${response.status}).`);
  }

  const rows = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const embeddings = rows.map((row) => row.embedding ?? []).filter((vec) => vec.length > 0);
  return validateEmbeddings(inputs, embeddings);
}

async function recordEmbeddingShadowPlanning(
  texts: string[],
  options: EmbedTextsOptions,
): Promise<void> {
  try {
    const routing = planRoute(
      {
        capability: "embedding",
        message: texts.join("\n").slice(0, 500),
        workspaceId: options.workspaceId,
      },
      { forceMode: "shadow" },
    );

    recordAiRuntime({
      provider: routing.providerName,
      model: routing.modelId,
      mode: "fallback",
      fallbackReason: "file_embeddings_shadow_plan",
      workspaceId: options.workspaceId,
      roomId: options.roomId,
      estimatedCostUsd: routing.estimatedCostUsd,
    });

    if (options.client && options.workspaceId) {
      await createAiWorkUnit(options.client, {
        workspaceId: options.workspaceId,
        roomId: options.roomId,
        topicId: options.topicId,
        workType: options.workType ?? "file_embedding",
        capability: "embedding",
        objective: "Shadow plan for file embeddings",
        status: "planned",
        runtimeMode: routing.runtimeMode,
        providerRoute: routing.providerRoute,
        providerName: routing.providerName,
        modelId: routing.modelId,
        estimatedCostUsd: routing.estimatedCostUsd,
        estimatedWorkMinutes: routing.estimatedWorkMinutes,
        metadata: {
          shadow: true,
          source: options.source ?? "file_embeddings",
          fileId: options.fileId,
          textCount: texts.length,
          chunkCount: texts.length,
        },
      });
    }
  } catch (error) {
    console.warn("[AdeHQ file embeddings shadow]", error);
  }
}

/** Runtime V2 path — used when AI_RUNTIME_V2_MODE=on. */
export async function embedTextsRuntime(
  texts: string[],
  options: EmbedTextsOptions = {},
): Promise<number[][]> {
  if (embeddingTestHooks?.forceRuntimeFailure) {
    throw embeddingTestHooks.forceRuntimeFailure instanceof Error
      ? embeddingTestHooks.forceRuntimeFailure
      : new Error("Forced file embeddings runtime failure (test hook)");
  }

  const inputs = texts.map(truncateForEmbedding).filter(Boolean);
  if (!inputs.length) return [];

  let workUnitId: string | undefined;
  const workType = options.workType ?? "file_embedding";

  if (options.client && options.workspaceId) {
    try {
      const created = await createAiWorkUnit(options.client, {
        workspaceId: options.workspaceId,
        roomId: options.roomId,
        topicId: options.topicId,
        workType,
        capability: "embedding",
        objective: "Embed file text chunks",
        runtimeMode: "embedding",
        metadata: {
          source: options.source ?? "file_embeddings",
          fileId: options.fileId,
          textCount: inputs.length,
          chunkCount: inputs.length,
          roomId: options.roomId,
          topicId: options.topicId,
        },
      });
      workUnitId = created.id;
      await startAiWorkUnit(options.client, options.workspaceId, workUnitId, {
        runtimeMode: "embedding",
        reasoningProfile: "none",
      });
    } catch (error) {
      console.warn("[AdeHQ file embeddings work unit]", error);
    }
  }

  const result = await runtimeEmbed(
    {
      workspaceId: options.workspaceId,
      workUnitId,
      capability: "embedding",
      runtimeMode: "embedding",
      reasoningProfile: "none",
      texts: inputs,
      modelId: DEFAULT_EMBEDDING_MODEL,
      metadata: {
        source: options.source ?? "file_embeddings",
        fileId: options.fileId,
        roomId: options.roomId,
        topicId: options.topicId,
        textCount: inputs.length,
        chunkCount: inputs.length,
      },
    },
    { forceMode: "on" },
  );

  const embeddings = validateEmbeddings(inputs, result.embeddings);

  if (options.client && options.workspaceId && workUnitId) {
    try {
      await completeAiWorkUnit(options.client, options.workspaceId, workUnitId, {
        actualCostUsd: result.usage.totalCostUsd,
        actualWorkMinutes: result.workMinutesEstimated,
        metadata: {
          providerRoute: result.usage.providerRoute,
          modelId: result.usage.modelId,
          providerCredentialId: result.usage.providerCredentialId,
          providerAllocationId: result.usage.providerAllocationId,
          providerProjectId: result.usage.providerProjectId,
          credentialSource: result.usage.credentialSource,
          inputTokens: result.usage.inputTokens,
          textCount: inputs.length,
        },
      });
    } catch (error) {
      console.warn("[AdeHQ file embeddings work unit complete]", error);
    }
  }

  recordAiRuntime({
    provider: result.usage.providerName,
    model: result.usage.modelId,
    mode: "live",
    workspaceId: options.workspaceId,
    roomId: options.roomId,
    inputTokens: result.usage.inputTokens,
    estimatedCostUsd: result.usage.totalCostUsd,
    durationMs: result.usage.latencyMs,
    agentRunId: workUnitId,
  });

  return embeddings;
}

/**
 * Embed multiple texts.
 * Dispatches by AI_RUNTIME_V2_MODE: off → old, shadow → old + shadow plan, on → runtime with fallback.
 */
export async function embedTexts(
  texts: string[],
  options: EmbedTextsOptions = {},
): Promise<number[][]> {
  const dispatch = getEmbedRuntimeDispatch();

  if (dispatch === "runtime-on") {
    try {
      return await embedTextsRuntime(texts, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAiRuntime({
        provider: "siliconflow",
        model: resolveModel("siliconflow", "cheap"),
        mode: "fallback",
        fallbackReason: "file_embeddings_runtime_failed",
        workspaceId: options.workspaceId,
        roomId: options.roomId,
        error: message,
      });

      let workUnitFailed = false;
      if (options.client && options.workspaceId) {
        try {
          const failed = await createAiWorkUnit(options.client, {
            workspaceId: options.workspaceId,
            roomId: options.roomId,
            topicId: options.topicId,
            workType: options.workType ?? "file_embedding",
            capability: "embedding",
            objective: "Runtime file embeddings failed — fell back to legacy path",
            status: "failed",
            metadata: { fallback: true, error: message, source: options.source ?? "file_embeddings" },
          });
          await failAiWorkUnit(options.client, options.workspaceId, failed.id, message);
          workUnitFailed = true;
        } catch {
          // debug only
        }
      }

      embeddingTestHooks?.onRuntimeFallback?.({ error: message, workUnitFailed });
      return embedTextsOld(texts);
    }
  }

  if (dispatch === "shadow") {
    void recordEmbeddingShadowPlanning(texts, options);
    return embedTextsOld(texts);
  }

  return embedTextsOld(texts);
}

export async function embedQueryText(
  text: string,
  options: EmbedTextsOptions = {},
): Promise<number[] | null> {
  if (!isFileEmbeddingAvailable() || !text.trim()) return null;

  try {
    const [embedding] = await embedTexts([text], {
      ...options,
      workType: options.workType ?? "query_embedding",
      source: options.source ?? "file_embeddings",
    });
    return embedding ?? null;
  } catch (error) {
    console.warn("[AdeHQ file embeddings] query embed failed", error);
    return null;
  }
}

type ChunkRow = { id: string; content: string };

export type EmbedFileChunksOptions = Omit<EmbedTextsOptions, "client" | "workspaceId" | "fileId">;

export async function embedFileChunks(
  client: SupabaseClient,
  workspaceId: string,
  fileId: string,
  chunks: ChunkRow[],
  options: EmbedFileChunksOptions = {},
): Promise<{ embedded: number; failed: number }> {
  if (!chunks.length || !isFileEmbeddingAvailable()) {
    return { embedded: 0, failed: 0 };
  }

  const chunkIds = chunks.map((c) => c.id);
  await client
    .from("file_chunks")
    .update({ embedding_status: "pending" })
    .eq("workspace_id", workspaceId)
    .eq("file_id", fileId)
    .in("id", chunkIds);

  let embedded = 0;
  let failed = 0;

  for (let offset = 0; offset < chunks.length; offset += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + EMBED_BATCH_SIZE);
    try {
      const vectors = await embedTexts(
        batch.map((c) => c.content),
        {
          ...options,
          client,
          workspaceId,
          fileId,
          workType: "file_embedding",
          source: options.source ?? "file_embeddings",
        },
      );
      await Promise.all(
        batch.map((chunk, index) =>
          client
            .from("file_chunks")
            .update({
              embedding: `[${vectors[index].join(",")}]`,
              embedding_status: "completed",
            })
            .eq("workspace_id", workspaceId)
            .eq("id", chunk.id),
        ),
      );
      embedded += batch.length;
    } catch (error) {
      console.warn("[AdeHQ file embeddings] batch failed", { fileId, offset, error });
      await client
        .from("file_chunks")
        .update({ embedding_status: "failed" })
        .eq("workspace_id", workspaceId)
        .eq("file_id", fileId)
        .in(
          "id",
          batch.map((c) => c.id),
        );
      failed += batch.length;
    }
  }

  return { embedded, failed };
}
