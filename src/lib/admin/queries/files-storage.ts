import type { SupabaseClient } from "@supabase/supabase-js";
import { AGGREGATION_ROW_LIMIT, daysAgoIso } from "./helpers";

export type FilesStorageSummary = {
  totalUsedBytes: number;
  totalArtifacts: number;
  uploads7d: number;
  byWorkspace: { workspaceId: string; name: string; usedBytes: number }[];
  fileTypeBreakdown: { type: string; count: number }[];
};

export async function getFilesStorageSummary(
  client: SupabaseClient,
): Promise<FilesStorageSummary> {
  const since = daysAgoIso(7);

  const [quotasRes, workspacesRes, artifactsRes, filesRes] = await Promise.all([
    client
      .from("workspace_storage_quotas")
      .select("workspace_id, used_bytes")
      .limit(AGGREGATION_ROW_LIMIT),
    client.from("workspaces").select("id, name").limit(AGGREGATION_ROW_LIMIT),
    client.from("artifacts").select("id, artifact_type, created_at").limit(AGGREGATION_ROW_LIMIT),
    client
      .from("drive_files")
      .select("mime_type, created_at")
      .gte("created_at", since)
      .limit(AGGREGATION_ROW_LIMIT),
  ]);

  // drive_files may not exist in all envs — tolerate missing table
  const quotas = quotasRes.error ? [] : quotasRes.data ?? [];
  if (workspacesRes.error) throw workspacesRes.error;
  if (artifactsRes.error) throw artifactsRes.error;

  const nameById = new Map((workspacesRes.data ?? []).map((w) => [w.id, w.name]));
  const totalUsedBytes = quotas.reduce((sum, q) => sum + Number(q.used_bytes ?? 0), 0);

  const byWorkspace = quotas
    .map((q) => ({
      workspaceId: q.workspace_id,
      name: nameById.get(q.workspace_id) ?? q.workspace_id,
      usedBytes: Number(q.used_bytes ?? 0),
    }))
    .sort((a, b) => b.usedBytes - a.usedBytes)
    .slice(0, 15);

  const typeMap = new Map<string, number>();
  for (const a of artifactsRes.data ?? []) {
    const t = a.artifact_type ?? "unknown";
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
  }

  const files = filesRes.error ? [] : filesRes.data ?? [];
  for (const f of files) {
    const mime = f.mime_type ?? "unknown";
    const category = mime.split("/")[0] ?? "unknown";
    typeMap.set(category, (typeMap.get(category) ?? 0) + 1);
  }

  return {
    totalUsedBytes,
    totalArtifacts: artifactsRes.data?.length ?? 0,
    uploads7d: files.length,
    byWorkspace,
    fileTypeBreakdown: [...typeMap.entries()].map(([type, count]) => ({ type, count })),
  };
}
