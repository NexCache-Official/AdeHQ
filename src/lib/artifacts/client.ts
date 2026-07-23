import { stableChecksum } from "@/lib/playbooks/checksum";
import {
  isArtifactExportV1Enabled,
  isArtifactRuntimeV1Enabled,
} from "./flags";
import { runQualityGate } from "./quality/quality-gate";
import { getArtifactRenderer } from "./renderers/registry";
import {
  artifactCanonicalObjectPath,
  artifactExportObjectPath,
  artifactVersionPrefix,
} from "./storage/paths";
import type { ArtifactExportFormat } from "./contracts/kinds";

export type CreateArtifactVersionInput = {
  workspaceId: string;
  artifactId: string;
  versionId: string;
  canonical: unknown;
  requiredSectionKeys?: string[];
};

export type CreateArtifactVersionResult = {
  ok: boolean;
  contentHash: string;
  storagePrefix: string;
  canonicalPath: string;
  qualityOk: boolean;
  errors: string[];
};

/** Thin helper — validates + hashes canonical content; persistence is caller's job. */
export async function createVersion(
  input: CreateArtifactVersionInput,
): Promise<CreateArtifactVersionResult> {
  if (!isArtifactRuntimeV1Enabled()) {
    return {
      ok: false,
      contentHash: "",
      storagePrefix: "",
      canonicalPath: "",
      qualityOk: false,
      errors: ["artifact runtime disabled"],
    };
  }

  const contentHash = stableChecksum(input.canonical);
  const gate = await runQualityGate({
    canonical: input.canonical,
    requiredSectionKeys: input.requiredSectionKeys,
  });

  return {
    ok: gate.ok,
    contentHash,
    storagePrefix: artifactVersionPrefix(input),
    canonicalPath: artifactCanonicalObjectPath(input),
    qualityOk: gate.ok,
    errors: gate.checks.flatMap((c) => c.errors),
  };
}

export type ExportArtifactInput = {
  workspaceId: string;
  artifactId: string;
  versionId: string;
  canonical: unknown;
  rendererKey: string;
  format: ArtifactExportFormat;
  generatedBy?: string;
};

export type ExportArtifactResult = {
  ok: boolean;
  storagePath?: string;
  mimeType?: string;
  buffer?: Buffer;
  errors: string[];
};

export async function exportArtifact(
  input: ExportArtifactInput,
): Promise<ExportArtifactResult> {
  if (!isArtifactRuntimeV1Enabled() || !isArtifactExportV1Enabled()) {
    return { ok: false, errors: ["artifact export disabled"] };
  }

  const renderer = getArtifactRenderer(input.rendererKey);
  if (!renderer) {
    return { ok: false, errors: [`unknown renderer: ${input.rendererKey}`] };
  }

  const gate = await runQualityGate({
    canonical: input.canonical,
    format: input.format,
  });
  if (!gate.ok) {
    return { ok: false, errors: gate.checks.flatMap((c) => c.errors) };
  }

  const rendered = await renderer.render({
    canonical: input.canonical,
    generatedBy: input.generatedBy,
  });

  return {
    ok: true,
    storagePath: artifactExportObjectPath({
      workspaceId: input.workspaceId,
      artifactId: input.artifactId,
      versionId: input.versionId,
      format: input.format,
    }),
    mimeType: rendered.mimeType,
    buffer: rendered.buffer,
    errors: [],
  };
}
