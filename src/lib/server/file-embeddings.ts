import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  isSiliconFlowConfigured,
  SILICONFLOW_API_BASE_URL,
} from "@/lib/config/features";

const MAX_EMBED_INPUT_CHARS = 4000;
const EMBED_BATCH_SIZE = 16;

function truncateForEmbedding(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EMBED_INPUT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_EMBED_INPUT_CHARS).trim()}…`;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
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

export async function embedQueryText(text: string): Promise<number[] | null> {
  if (!isSiliconFlowConfigured() || !text.trim()) return null;
  try {
    const [embedding] = await embedTexts([text]);
    return embedding ?? null;
  } catch (error) {
    console.warn("[AdeHQ file embeddings] query embed failed", error);
    return null;
  }
}

type ChunkRow = { id: string; content: string };

export async function embedFileChunks(
  client: SupabaseClient,
  workspaceId: string,
  fileId: string,
  chunks: ChunkRow[],
): Promise<{ embedded: number; failed: number }> {
  if (!chunks.length || !isSiliconFlowConfigured()) {
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
      const vectors = await embedTexts(batch.map((c) => c.content));
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
