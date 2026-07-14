/**
 * Move Drive objects whose storage_path contains spaces to sanitized paths.
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/backfill-drive-storage-paths.ts dotenv_config_path=.env.local
 *   WORKSPACE_ID=<uuid> npx tsx -r dotenv/config scripts/backfill-drive-storage-paths.ts dotenv_config_path=.env.local
 */
import { createClient } from "@supabase/supabase-js";
import { sanitizeFileName } from "../src/lib/files/sanitize-file-name";

function sanitizePath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      const dot = segment.lastIndexOf(".");
      if (dot > 0) {
        const base = segment.slice(0, dot);
        const ext = segment.slice(dot + 1);
        return `${sanitizeFileName(base)}.${ext.replace(/[^\w]+/g, "")}`;
      }
      return sanitizeFileName(segment);
    })
    .join("/");
}

async function moveAndUpdate(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  bucket: string;
  fromPath: string;
  table: string;
  id: string;
  workspaceId: string;
  pathColumn?: string;
  metadata?: Record<string, unknown> | null;
}) {
  const toPath = sanitizePath(params.fromPath);
  if (params.fromPath === toPath) return;
  console.log(`Move [${params.bucket}] ${params.fromPath} → ${toPath}`);

  const { error: moveError } = await params.client.storage
    .from(params.bucket)
    .move(params.fromPath, toPath);
  if (moveError) {
    console.warn(`  move warning: ${moveError.message}`);
  }

  if (params.metadata) {
    const { error } = await params.client
      .from(params.table)
      .update({ metadata: { ...params.metadata, storagePath: toPath } })
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.id);
    if (error) throw error;
    return;
  }

  const column = params.pathColumn ?? "storage_path";
  const { error } = await params.client
    .from(params.table)
    .update({ [column]: toPath })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.id);
  if (error) throw error;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }
  const workspaceFilter = process.env.WORKSPACE_ID?.trim() || null;
  const client = createClient(url, key, { auth: { persistSession: false } });

  for (const table of ["workspace_files", "drive_exports"] as const) {
    const select =
      table === "drive_exports"
        ? "id, workspace_id, storage_path, storage_bucket"
        : "id, workspace_id, storage_path";
    let query = client.from(table).select(select).not("storage_path", "is", null);
    if (workspaceFilter) query = query.eq("workspace_id", workspaceFilter);
    const { data, error } = await query;
    if (error) {
      console.warn(`${table}: ${error.message}`);
      continue;
    }
    type StorageRow = {
      id: string;
      workspace_id: string;
      storage_path: string | null;
      storage_bucket?: string | null;
    };
    for (const raw of data ?? []) {
      const row = raw as StorageRow;
      const path = String(row.storage_path ?? "");
      if (!path.includes(" ")) continue;
      const bucket = String(
        row.storage_bucket ||
          (table === "drive_exports" ? "adehq-exports" : "adehq-files"),
      );
      await moveAndUpdate({
        client,
        bucket,
        fromPath: path,
        table,
        id: String(row.id),
        workspaceId: String(row.workspace_id),
      });
    }
  }

  let artQuery = client.from("artifacts").select("id, workspace_id, metadata, title");
  if (workspaceFilter) artQuery = artQuery.eq("workspace_id", workspaceFilter);
  const { data: artifacts, error: artError } = await artQuery;
  if (artError) {
    console.warn(`artifacts: ${artError.message}`);
  } else {
    for (const artifact of artifacts ?? []) {
      const meta = (artifact.metadata ?? {}) as Record<string, unknown>;
      const path = typeof meta.storagePath === "string" ? meta.storagePath : null;
      if (!path || !path.includes(" ")) continue;
      await moveAndUpdate({
        client,
        bucket: "adehq-artifacts",
        fromPath: path,
        table: "artifacts",
        id: String(artifact.id),
        workspaceId: String(artifact.workspace_id),
        metadata: meta,
      });
    }
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
