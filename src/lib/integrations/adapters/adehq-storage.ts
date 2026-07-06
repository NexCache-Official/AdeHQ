// ===========================================================================
// AdeHQ storage adapter — syncs generated artifacts/files to workspace Drive.
// Thin wrapper over the existing Drive storage sync so Phase 2 artifact tools
// (artifact.createSpreadsheet / createPdfReport / saveToDrive) plug in here.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { syncArtifactToStorage } from "@/lib/drive/storage-sync";

export async function saveArtifactToDrive(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    artifactId: string;
    title: string;
    contentMarkdown: string;
    employeeId: string;
  },
): Promise<{ storagePath: string; sizeBytes: number } | null> {
  try {
    return await syncArtifactToStorage(
      client,
      {
        id: params.artifactId,
        workspaceId: params.workspaceId,
        title: params.title,
        contentMarkdown: params.contentMarkdown,
        metadata: {},
        driveFolderId: null,
      },
      params.employeeId,
    );
  } catch (error) {
    // Drive sync is best-effort — the artifact row is the source of truth.
    console.warn("[AdeHQ integrations] artifact Drive sync failed", error);
    return null;
  }
}
