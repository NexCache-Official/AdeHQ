// ===========================================================================
// Artifact job handlers — spreadsheet + PDF report generation (Phase 2).
// Registered on module load; polled via GET /api/integrations/jobs/[jobId].
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { IntegrationJobRecord } from "@/lib/integrations/types";
import { registerJobHandler, type JobHandlerResult } from "./registry";
import { spreadsheetMarkdownPreview } from "@/lib/artifacts/engine/spreadsheet";
import { buildEnhancedSpreadsheetBuffer } from "@/lib/artifacts/engine/spreadsheet-enhanced";
import {
  buildReportMarkdown,
  buildSimplePdfBuffer,
} from "@/lib/artifacts/engine/pdf-report";
import { DRIVE_BUCKETS } from "@/lib/drive/constants";
import { exportStoragePath } from "@/lib/drive/storage-sync";
import { recordStorageUsage } from "@/lib/drive/quota-server";
import { uid, nowISO } from "@/lib/utils";
import type {
  CreatePdfReportArgs,
  CreateSpreadsheetArgs,
} from "@/lib/integrations/registry/tool-definitions";
import { applySpreadsheetTemplate } from "@/lib/artifacts/templates/spreadsheets/index";
import { applyPdfTemplate } from "@/lib/artifacts/templates/pdf/index";

type JobPayload = {
  tool?: string;
  args?: Record<string, unknown>;
  ctx?: {
    roomId?: string;
    topicId?: string;
    employeeId?: string;
    triggerMessageId?: string;
  };
};

async function writeArtifactWorkLog(
  client: SupabaseClient,
  job: IntegrationJobRecord,
  params: {
    action: string;
    summary: string;
    artifactId: string;
    toolName: string;
  },
): Promise<void> {
  const ctx = (job.payload as JobPayload).ctx;
  if (!ctx?.roomId || !job.employeeId) return;

  await client.from("work_log_events").insert({
    workspace_id: job.workspaceId,
    id: uid("wl"),
    room_id: ctx.roomId,
    topic_id: ctx.topicId ?? null,
    employee_id: job.employeeId,
    action: params.action,
    summary: params.summary,
    tool_used: params.toolName,
    status: "success",
    related_entity_type: "artifact",
    related_entity_id: params.artifactId,
    created_at: nowISO(),
  });
}

async function persistBinaryExport(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId: string;
    roomId?: string;
    topicId?: string;
    title: string;
    ext: string;
    mimeType: string;
    buffer: Buffer;
    artifactId: string;
    exportType: string;
  },
): Promise<{ exportId: string; storagePath: string }> {
  const exportId = randomUUID();
  const storagePath = exportStoragePath(
    params.workspaceId,
    exportId,
    params.title,
    params.ext,
  );

  const mimeType =
    params.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    params.mimeType === "application/pdf"
      ? "application/octet-stream"
      : params.mimeType;

  const { error: uploadError } = await client.storage
    .from(DRIVE_BUCKETS.exports)
    .upload(storagePath, params.buffer, {
      contentType: mimeType,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { error: insertError } = await client.from("drive_exports").insert({
    id: exportId,
    workspace_id: params.workspaceId,
    room_id: params.roomId ?? null,
    topic_id: params.topicId ?? null,
    title: `${params.title} (export)`,
    export_type: params.exportType,
    storage_bucket: DRIVE_BUCKETS.exports,
    storage_path: storagePath,
    mime_type: params.mimeType,
    size_bytes: params.buffer.byteLength,
    source_artifact_ids: [params.artifactId],
    source_file_ids: [],
    created_by_user_id: null,
    metadata: { generatedByEmployeeId: params.employeeId },
  });
  if (insertError) throw insertError;

  await recordStorageUsage({
    workspaceId: params.workspaceId,
    eventType: "export",
    bucket: DRIVE_BUCKETS.exports,
    objectPath: storagePath,
    sizeBytes: params.buffer.byteLength,
    deltaBytes: params.buffer.byteLength,
    entityType: "export",
    entityId: exportId,
  }).catch(() => undefined);

  return { exportId, storagePath };
}

async function createArtifactRow(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    employeeId: string;
    roomId?: string;
    topicId?: string;
    triggerMessageId?: string;
    title: string;
    artifactType: "report" | "other";
    contentMarkdown: string;
    contentJson: Record<string, unknown>;
  },
): Promise<string> {
  const artifactId = randomUUID();
  const { error } = await client.from("artifacts").insert({
    workspace_id: params.workspaceId,
    id: artifactId,
    room_id: params.roomId ?? null,
    topic_id: params.topicId ?? null,
    title: params.title,
    artifact_type: params.artifactType,
    status: "saved",
    content_markdown: params.contentMarkdown,
    content_json: params.contentJson,
    created_by_type: "ai",
    created_by_id: params.employeeId,
    source_file_ids: [],
    source_message_ids: params.triggerMessageId ? [params.triggerMessageId] : [],
    source_chunk_ids: [],
    source_citations: [],
    metadata: { integrationGenerated: true },
  });
  if (error) throw error;

  await client.from("artifact_versions").insert({
    artifact_id: artifactId,
    version_number: 1,
    content_markdown: params.contentMarkdown,
    content_json: params.contentJson,
    source_citations: [],
    created_by_type: "ai",
    created_by_id: params.employeeId,
  });

  return artifactId;
}

async function handleSpreadsheetJob(
  client: SupabaseClient,
  job: IntegrationJobRecord,
): Promise<JobHandlerResult> {
  const payload = job.payload as JobPayload;
  const args = payload.args as CreateSpreadsheetArgs;
  const ctx = payload.ctx ?? {};
  const employeeId = job.employeeId ?? ctx.employeeId;
  if (!employeeId) throw new Error("Missing employee for spreadsheet job.");

  const title = args.title.trim();
  const templated = applySpreadsheetTemplate(args);

  const buffer = buildEnhancedSpreadsheetBuffer({
    sheetName: templated.sheetName,
    columns: templated.columns,
    rows: templated.rows,
    meta: {
      title,
      generatedBy: employeeId,
      source: templated.template
        ? `artifact.createSpreadsheet (${templated.template})`
        : "artifact.createSpreadsheet",
    },
  });
  const previewMd = spreadsheetMarkdownPreview({
    columns: templated.columns,
    rows: templated.rows,
    sheetName: templated.sheetName,
  });

  const artifactId = await createArtifactRow(client, {
    workspaceId: job.workspaceId,
    employeeId,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    triggerMessageId: ctx.triggerMessageId,
    title,
    artifactType: "report",
    contentMarkdown: `# ${title}\n\n${previewMd}`,
    contentJson: {
      kind: "spreadsheet",
      template: args.template ?? null,
      columns: templated.columns,
      rowCount: templated.rows.length,
      sheetName: templated.sheetName ?? "Sheet1",
    },
  });

  const { exportId } = await persistBinaryExport(client, {
    workspaceId: job.workspaceId,
    employeeId,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    title,
    ext: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
    artifactId,
    exportType: "artifact_bundle",
  });

  const summary = `Generated spreadsheet "${title}" (${templated.rows.length} rows) — saved to Drive.`;
  await writeArtifactWorkLog(client, job, {
    action: "artifact_spreadsheet_created",
    summary,
    artifactId,
    toolName: "artifact.createSpreadsheet",
  });

  return {
    result: { artifactId, exportId, title, rowCount: templated.rows.length, template: args.template },
    costUsd: 0.002,
    summary,
  };
}

async function handlePdfReportJob(
  client: SupabaseClient,
  job: IntegrationJobRecord,
): Promise<JobHandlerResult> {
  const payload = job.payload as JobPayload;
  const args = payload.args as CreatePdfReportArgs;
  const ctx = payload.ctx ?? {};
  const employeeId = job.employeeId ?? ctx.employeeId;
  if (!employeeId) throw new Error("Missing employee for PDF report job.");

  const spec = applyPdfTemplate(args);
  const contentMarkdown = buildReportMarkdown({
    ...spec,
    generatedBy: employeeId,
    generatedAt: new Date().toISOString(),
  });
  const pdfBuffer = buildSimplePdfBuffer({
    ...spec,
    generatedBy: employeeId,
    generatedAt: new Date().toISOString(),
  });
  const title = args.title.trim();

  const artifactId = await createArtifactRow(client, {
    workspaceId: job.workspaceId,
    employeeId,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    triggerMessageId: ctx.triggerMessageId,
    title,
    artifactType: "report",
    contentMarkdown,
    contentJson: {
      kind: "pdf_report",
      template: args.template ?? null,
      sectionCount: spec.sections.length,
      summary: spec.summary ?? null,
    },
  });

  const { exportId } = await persistBinaryExport(client, {
    workspaceId: job.workspaceId,
    employeeId,
    roomId: ctx.roomId,
    topicId: ctx.topicId,
    title,
    ext: "pdf",
    mimeType: "application/pdf",
    buffer: pdfBuffer,
    artifactId,
    exportType: "report",
  });

  const summary = `Generated report "${title}" — saved as artifact and PDF export.`;
  await writeArtifactWorkLog(client, job, {
    action: "artifact_pdf_created",
    summary,
    artifactId,
    toolName: "artifact.createPdfReport",
  });

  return {
    result: { artifactId, exportId, title, sectionCount: args.sections.length },
    costUsd: 0.005,
    summary,
  };
}

registerJobHandler("artifact_xlsx", handleSpreadsheetJob);
registerJobHandler("artifact_pdf", handlePdfReportJob);
