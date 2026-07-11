// ===========================================================================
// Embedding-based role matching — Intelligence v2 Phase 3a.
//
// Replaces an LLM classification call with a ~50ms cosine-similarity lookup
// for the "no clear regex signal" case in room orchestration. Each employee's
// role/instructions are embedded once and cached on ai_employees.role_embedding;
// re-embedded lazily only when the underlying role summary text changes.
//
// A workspace has at most a few dozen employees, so similarity is computed in
// application code against this small in-memory set — no pgvector/HNSW index
// needed (unlike file_chunks, which can hold thousands of rows).
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQueryText, isFileEmbeddingAvailable } from "@/lib/server/file-embeddings";
import type { RoomStewardRosterEmployee } from "./room-steward";

export type EmployeeEmbeddingMatch = {
  employeeId: string;
  similarity: number;
};

/** Compact, stable text summary an employee's role embedding is computed from. */
export function buildEmployeeRoleSummaryText(employee: RoomStewardRosterEmployee): string {
  return [employee.roleTitle, employee.roleKey, employee.expertiseSummary]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 2000);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

type EmployeeEmbeddingRow = {
  id: string;
  role_embedding: number[] | null;
  role_embedding_source: string | null;
};

/**
 * Loads cached role embeddings for the given roster from ai_employees,
 * computing and persisting any that are missing or stale (role text changed
 * since the cached embedding was computed). Returns a map of employeeId ->
 * embedding vector, omitting employees whose embedding couldn't be resolved.
 */
async function ensureRoleEmbeddings(
  client: SupabaseClient,
  workspaceId: string,
  roster: RoomStewardRosterEmployee[],
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (!roster.length || !isFileEmbeddingAvailable()) return result;

  const ids = roster.map((e) => e.employeeId);
  const { data, error } = await client
    .from("ai_employees")
    .select("id, role_embedding, role_embedding_source")
    .eq("workspace_id", workspaceId)
    .in("id", ids);

  if (error) {
    console.warn("[AdeHQ role embeddings] fetch failed", error);
    return result;
  }

  const rows = new Map<string, EmployeeEmbeddingRow>(
    ((data ?? []) as EmployeeEmbeddingRow[]).map((row) => [row.id, row]),
  );

  const stale: RoomStewardRosterEmployee[] = [];
  for (const employee of roster) {
    const row = rows.get(employee.employeeId);
    const summary = buildEmployeeRoleSummaryText(employee);
    if (row?.role_embedding?.length && row.role_embedding_source === summary) {
      result.set(employee.employeeId, row.role_embedding);
    } else {
      stale.push(employee);
    }
  }

  if (!stale.length) return result;

  await Promise.all(
    stale.map(async (employee) => {
      const summary = buildEmployeeRoleSummaryText(employee);
      try {
        const embedding = await embedQueryText(summary, {
          client,
          workspaceId,
          source: "employee_role_match",
        });
        if (!embedding) return;
        result.set(employee.employeeId, embedding);
        const { error: updateError } = await client
          .from("ai_employees")
          .update({ role_embedding: embedding, role_embedding_source: summary })
          .eq("workspace_id", workspaceId)
          .eq("id", employee.employeeId);
        if (updateError) {
          console.warn("[AdeHQ role embeddings] cache write failed", updateError);
        }
      } catch (error) {
        console.warn("[AdeHQ role embeddings] embed failed", { employeeId: employee.employeeId, error });
      }
    }),
  );

  return result;
}

/**
 * Ranks roster employees by cosine similarity between the message and each
 * employee's cached role embedding. Returns [] if embeddings aren't
 * available/configured (caller should fall back to the LLM steward).
 */
export async function rankEmployeesByRoleEmbedding(
  client: SupabaseClient,
  workspaceId: string,
  messageText: string,
  roster: RoomStewardRosterEmployee[],
): Promise<EmployeeEmbeddingMatch[]> {
  if (!messageText.trim() || !roster.length || !isFileEmbeddingAvailable()) return [];

  const [messageEmbedding, roleEmbeddings] = await Promise.all([
    embedQueryText(messageText, { client, workspaceId, source: "room_orchestration_query" }),
    ensureRoleEmbeddings(client, workspaceId, roster),
  ]);

  if (!messageEmbedding || !roleEmbeddings.size) return [];

  return roster
    .map((employee) => {
      const vector = roleEmbeddings.get(employee.employeeId);
      if (!vector) return null;
      return { employeeId: employee.employeeId, similarity: cosineSimilarity(messageEmbedding, vector) };
    })
    .filter((row): row is EmployeeEmbeddingMatch => row !== null)
    .sort((a, b) => b.similarity - a.similarity);
}
